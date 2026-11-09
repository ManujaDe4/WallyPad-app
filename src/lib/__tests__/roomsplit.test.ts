import { describe, expect, test } from 'vitest';
import type { Backup, Expense, Household } from '../../types';
import { calculateBalances, calculateTotalSpending, suggestRepayments } from '../balances';
import { validateBackupJson } from '../backup';
import { parseMoney } from '../money';
import { buildCustomSplit, splitEqual } from '../split';
import { buildSupermarketSplit, evaluateMoneyExpression } from '../mathInput';
import {
  buildWeeklyAndMonthlySummaries,
  decodeShareSnapshot,
  encodeShareSnapshot,
} from '../reports';
import { decryptBackupJson, encryptBackupJson } from '../cryptoBackup';
import { hashPin, mergeHouseholds } from '../cloudSync';

function createExpense(
  id: string,
  amountCents: number,
  paidById: string,
  shares: Expense['shares'],
): Expense {
  return {
    id,
    title: `Expense ${id}`,
    category: 'Other',
    amountCents,
    paidById,
    date: '2026-11-08',
    splitMode: 'equal',
    shares,
  };
}

function createDemoHousehold(): Household {
  return {
    id: 'demo-house-1',
    name: 'Colombo Student Flat',
    currency: 'LKR',
    updatedAt: '2026-11-08',
    members: [
      { id: 'm1', name: 'Manuja' },
      { id: 'm2', name: 'Nimal' },
      { id: 'm3', name: 'Kavindu' },
    ],
    expenses: [
      createExpense('e1', 300000, 'm1', [
        { memberId: 'm1', amountCents: 100000 },
        { memberId: 'm2', amountCents: 100000 },
        { memberId: 'm3', amountCents: 100000 },
      ]),
      createExpense('e2', 150000, 'm2', [
        { memberId: 'm1', amountCents: 50000 },
        { memberId: 'm2', amountCents: 50000 },
        { memberId: 'm3', amountCents: 50000 },
      ]),
      createExpense('e3', 60000, 'm3', [
        { memberId: 'm1', amountCents: 20000 },
        { memberId: 'm2', amountCents: 20000 },
        { memberId: 'm3', amountCents: 20000 },
      ]),
    ],
    repayments: [],
  };
}

function createBackup(household = createDemoHousehold()): Backup {
  return {
    app: 'RoomSplit',
    schemaVersion: 1,
    exportedAt: '2026-11-08T12:00:00.000Z',
    household,
  };
}

describe('cloud household merging', () => {
  test('hashes trimmed PINs consistently with the normalized room code', async () => {
    const hash = await hashPin(' flat-4829 ', ' 1234 ');

    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    await expect(hashPin('FLAT-4829', '1234')).resolves.toBe(hash);
  });

  test('preserves concurrent expenses and removes tombstoned records', () => {
    const local = createDemoHousehold();
    const remote = createDemoHousehold();
    local.members.push({ id: 'offline-member-local', name: 'Local housemate' });
    remote.members.push({ id: 'offline-member-remote', name: 'Remote housemate' });
    local.expenses = [
      ...local.expenses,
      createExpense('offline-local', 1200, 'm1', []),
      createExpense('deleted-expense', 500, 'm1', []),
    ];
    remote.expenses = [
      ...remote.expenses,
      createExpense('offline-remote', 2400, 'm2', []),
      createExpense('deleted-expense', 500, 'm1', []),
    ];
    remote.repayments = [{
      id: 'deleted-repayment',
      fromId: 'm1',
      toId: 'm2',
      amountCents: 500,
      date: '2026-11-08',
    }];
    local.repayments.push({
      id: 'offline-repayment-local',
      fromId: 'm1',
      toId: 'm2',
      amountCents: 700,
      date: '2026-11-08',
    });
    remote.repayments.push({
      id: 'offline-repayment-remote',
      fromId: 'm2',
      toId: 'm3',
      amountCents: 800,
      date: '2026-11-08',
    });
    local.members.push({ id: 'deleted-member', name: 'Temporary' });
    local.deletedIds = ['deleted-member'];
    remote.deletedIds = ['deleted-expense'];

    const merged = mergeHouseholds(local, remote, ['deleted-repayment']);

    expect(merged.expenses.map((expense) => expense.id)).toEqual(
      expect.arrayContaining(['offline-local', 'offline-remote']),
    );
    expect(merged.members.map((member) => member.id)).toEqual(
      expect.arrayContaining(['offline-member-local', 'offline-member-remote']),
    );
    expect(merged.repayments.map((repayment) => repayment.id)).toEqual(
      expect.arrayContaining(['offline-repayment-local', 'offline-repayment-remote']),
    );
    expect(merged.expenses.some((expense) => expense.id === 'deleted-expense')).toBe(false);
    expect(merged.members.some((member) => member.id === 'deleted-member')).toBe(false);
    expect(merged.repayments.some((repayment) => repayment.id === 'deleted-repayment')).toBe(false);
    expect(merged.deletedIds).toContain('deleted-expense');
    expect(merged.deletedIds).toContain('deleted-member');
    expect(merged.deletedIds).toContain('deleted-repayment');
  });
});

describe('money and splits', () => {
  test('parses valid money into integer cents', () => {
    expect(parseMoney('125.50')).toEqual({ ok: true, cents: 12550 });
  });

  test('splits LKR 100.00 equally among three members without losing cents', () => {
    const result = splitEqual(10000, ['m1', 'm2', 'm3']);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.shares.map((share) => share.amountCents)).toEqual([
        3334, 3333, 3333,
      ]);
      expect(
        result.shares.reduce((sum, share) => sum + share.amountCents, 0),
      ).toBe(10000);
    }
  });

  test('rejects custom shares that are too high or too low and accepts an exact sum', () => {
    const tooHigh = buildCustomSplit(90000, ['m1', 'm2', 'm3'], {
      m1: '500.00',
      m2: '250.00',
      m3: '200.00',
    });
    const tooLow = buildCustomSplit(90000, ['m1', 'm2', 'm3'], {
      m1: '500.00',
      m2: '250.00',
      m3: '100.00',
    });
    const exact = buildCustomSplit(90000, ['m1', 'm2', 'm3'], {
      m1: '500.00',
      m2: '250.00',
      m3: '150.00',
    });

    expect(tooHigh.ok).toBe(false);
    if (!tooHigh.ok) expect(tooHigh.error).toMatch(/over by LKR 50\.00/);
    expect(tooLow.ok).toBe(false);
    if (!tooLow.ok) expect(tooLow.error).toMatch(/short by LKR 50\.00/);
    expect(exact.ok).toBe(true);
    if (exact.ok) {
      expect(exact.shares.map((share) => share.amountCents)).toEqual([
        50000, 25000, 15000,
      ]);
    }
  });

  test('evaluates a safe plus and minus money expression', () => {
    expect(evaluateMoneyExpression('1200 + 450.50 - 50')).toEqual({
      ok: true,
      cents: 160050,
    });
    expect(evaluateMoneyExpression('10 - 12').ok).toBe(false);
    expect(evaluateMoneyExpression('10 * 2').ok).toBe(false);
  });

  test('deducts personal supermarket items before splitting shared balance', () => {
    const result = buildSupermarketSplit(
      500000,
      ['m1', 'm2', 'm3'],
      { m3: '800.00' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.shares.map((share) => [share.memberId, share.amountCents]))
        .toEqual([['m1', 140000], ['m2', 140000], ['m3', 220000]]);
      expect(result.shares.reduce((sum, share) => sum + share.amountCents, 0))
        .toBe(500000);
    }
  });
});

describe('balances and repayments', () => {
  test('credits a payer who is excluded from the split', () => {
    const household = createDemoHousehold();
    household.expenses = [
      createExpense('excluded-payer', 10000, 'm1', [
        { memberId: 'm2', amountCents: 5000 },
        { memberId: 'm3', amountCents: 5000 },
      ]),
    ];

    expect(calculateBalances(household).map((balance) => balance.balanceCents))
      .toEqual([10000, -5000, -5000]);
  });

  test('calculates the page 8 demo fixture and suggested transfers', () => {
    const household = createDemoHousehold();
    const balances = calculateBalances(household);

    expect(balances.map((balance) => balance.balanceCents)).toEqual([
      130000, -20000, -110000,
    ]);
    expect(
      suggestRepayments(balances).map((transfer) => [
        transfer.fromId,
        transfer.toId,
        transfer.amountCents,
      ]),
    ).toEqual([
      ['m3', 'm1', 110000],
      ['m2', 'm1', 20000],
    ]);
  });

  test('applies a partial repayment of LKR 500.00', () => {
    const household = createDemoHousehold();
    household.repayments.push({
      id: 'rep-1',
      fromId: 'm3',
      toId: 'm1',
      amountCents: 50000,
      date: '2026-11-08',
    });

    expect(calculateBalances(household).map((balance) => balance.balanceCents))
      .toEqual([80000, -20000, -60000]);
  });

  test('settles all suggested transfers without changing total spending', () => {
    const household = createDemoHousehold();
    household.repayments = [
      {
        id: 'rep-kavindu',
        fromId: 'm3',
        toId: 'm1',
        amountCents: 110000,
        date: '2026-11-08',
      },
      {
        id: 'rep-nimal',
        fromId: 'm2',
        toId: 'm1',
        amountCents: 20000,
        date: '2026-11-08',
      },
    ];

    expect(calculateBalances(household).map((balance) => balance.balanceCents))
      .toEqual([0, 0, 0]);
    expect(calculateTotalSpending(household)).toBe(510000);
  });

  test('recalculates balances after replacing or deleting an expense', () => {
    const household = createDemoHousehold();
    const replacement = createExpense('e1', 240000, 'm1', [
      { memberId: 'm1', amountCents: 80000 },
      { memberId: 'm2', amountCents: 80000 },
      { memberId: 'm3', amountCents: 80000 },
    ]);
    const edited = {
      ...household,
      expenses: household.expenses.map((expense) =>
        expense.id === replacement.id ? replacement : expense,
      ),
    };

    expect(edited.expenses).toHaveLength(3);
    expect(new Set(edited.expenses.map((expense) => expense.id)).size).toBe(3);
    expect(calculateBalances(edited).map((balance) => balance.balanceCents))
      .toEqual([90000, 0, -90000]);
    expect(
      calculateBalances(edited).reduce(
        (sum, balance) => sum + balance.balanceCents,
        0,
      ),
    ).toBe(0);

    const deleted = {
      ...household,
      expenses: household.expenses.filter((expense) => expense.id !== 'e1'),
    };
    expect(deleted.expenses).toHaveLength(2);
    expect(calculateBalances(deleted).map((balance) => balance.balanceCents))
      .toEqual([-70000, 80000, -10000]);
    expect(
      calculateBalances(deleted).reduce(
        (sum, balance) => sum + balance.balanceCents,
        0,
      ),
    ).toBe(0);
  });
});

describe('backup validation', () => {
  test('rejects expense payers and shares that reference missing members', () => {
    const invalidPayer = createBackup();
    invalidPayer.household.expenses[0].paidById = 'missing';
    const invalidShare = createBackup();
    invalidShare.household.expenses[0].shares[0].memberId = 'missing';

    expect(validateBackupJson(JSON.stringify(invalidPayer)).ok).toBe(false);
    expect(validateBackupJson(JSON.stringify(invalidShare)).ok).toBe(false);
  });

  describe('expense reports', () => {
    test('groups weekly summaries Monday to Sunday and monthly summaries', () => {
      const expenses = [
        createExpense('week-a', 10000, 'm1', [{ memberId: 'm1', amountCents: 10000 }]),
        { ...createExpense('week-a2', 20000, 'm2', [{ memberId: 'm2', amountCents: 20000 }]), date: '2026-11-08', category: 'Rent' },
        { ...createExpense('week-b', 30000, 'm3', [{ memberId: 'm3', amountCents: 30000 }]), date: '2026-11-09', category: 'Groceries' },
        { ...createExpense('month-b', 40000, 'm1', [{ memberId: 'm1', amountCents: 40000 }]), date: '2026-12-01', category: 'Utilities' },
      ];
      const summaries = buildWeeklyAndMonthlySummaries(expenses);

      expect(summaries.weekly).toEqual([
        expect.objectContaining({
          period: '2026-11-30 to 2026-12-06',
          billCount: 1,
          totalCents: 40000,
          topCategory: 'Utilities',
        }),
        expect.objectContaining({
          period: '2026-11-09 to 2026-11-15',
          billCount: 1,
          totalCents: 30000,
          topCategory: 'Groceries',
        }),
        expect.objectContaining({
          period: '2026-11-02 to 2026-11-08',
          billCount: 2,
          totalCents: 30000,
          topCategory: 'Rent',
        }),
      ]);
      expect(summaries.monthly).toEqual([
        expect.objectContaining({ period: '2026-12', billCount: 1, totalCents: 40000 }),
        expect.objectContaining({ period: '2026-11', billCount: 3, totalCents: 60000 }),
      ]);
    });

    test('encodes a compact read-only settlement snapshot for URL sharing', () => {
      const household = createDemoHousehold();
      const decoded = decodeShareSnapshot(encodeShareSnapshot(household));
      expect(decoded.name).toBe(household.name);
      expect(decoded.totalSpendingCents).toBe(510000);
      expect(decoded.transfers.map((transfer) => transfer.amountCents)).toEqual([
        110000, 20000,
      ]);
      expect(decoded).not.toHaveProperty('expenses');
    });
  });

  describe('encrypted backups', () => {
    test('encrypts and decrypts backup text using a password', async () => {
      const plaintext = JSON.stringify(createBackup());
      const encrypted = await encryptBackupJson(plaintext, 'household-secret');
      expect(encrypted).not.toContain('Colombo Student Flat');
      await expect(decryptBackupJson(encrypted, 'household-secret')).resolves.toBe(plaintext);
      await expect(decryptBackupJson(encrypted, 'wrong-password')).rejects.toThrow(
        'Could not decrypt backup. Check the password and file.',
      );
    });
  });

  test('round-trips an exported backup with identical ledger and derived balances', () => {
    const backup = createBackup();
    backup.household.members[0].avatar = '🦁';
    const result = validateBackupJson(JSON.stringify(backup));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.household).toEqual(backup.household);
      expect(calculateBalances(result.household)).toEqual(
        calculateBalances(backup.household),
      );
    }
  });

  test('rejects malformed, oversized, wrong-version, and invalid-amount backups clearly', () => {
    const malformed = validateBackupJson('{not json');
    const oversized = validateBackupJson(' '.repeat(2 * 1024 * 1024 + 1));
    const wrongVersion = validateBackupJson(
      JSON.stringify({ ...createBackup(), schemaVersion: 2 }),
    );
    const invalidAmountBackup = createBackup();
    invalidAmountBackup.household.expenses[0].amountCents = -1;
    const invalidAmount = validateBackupJson(
      JSON.stringify(invalidAmountBackup),
    );

    expect(malformed).toMatchObject({
      ok: false,
      error: 'Backup file is not valid JSON.',
    });
    expect(oversized).toMatchObject({
      ok: false,
      error: 'Backup file must be 2 MB or smaller.',
    });
    expect(wrongVersion).toMatchObject({
      ok: false,
      error: 'Unsupported backup schema version.',
    });
    expect(invalidAmount.ok).toBe(false);
    if (!invalidAmount.ok) {
      expect(invalidAmount.error).toBe('An expense record is invalid.');
    }
  });
});

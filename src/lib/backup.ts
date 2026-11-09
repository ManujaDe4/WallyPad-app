import type { Expense, Household, Member, Repayment, Share, SpaceAccent } from '../types';

const MAX_BACKUP_BYTES = 2 * 1024 * 1024;
const MAX_AMOUNT_CENTS = 100_000_000;

type BackupValidationResult =
  | { ok: true; household: Household }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function safeAdd(a: number, b: number): number | null {
  const sum = a + b;
  return Number.isSafeInteger(sum) ? sum : null;
}

function validationError(error: string): BackupValidationResult {
  return { ok: false, error };
}

export function validateBackupJson(rawText: string): BackupValidationResult {
  if (new TextEncoder().encode(rawText).byteLength > MAX_BACKUP_BYTES) {
    return validationError('Backup file must be 2 MB or smaller.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return validationError('Backup file is not valid JSON.');
  }

  if (!isRecord(parsed)) {
    return validationError('Backup must be a JSON object.');
  }
  if (parsed.app !== 'RoomSplit') {
    return validationError('Backup app must be "RoomSplit".');
  }
  if (parsed.schemaVersion !== 1) {
    return validationError('Unsupported backup schema version.');
  }
  if (
    typeof parsed.exportedAt !== 'string' ||
    Number.isNaN(Date.parse(parsed.exportedAt))
  ) {
    return validationError('Backup export timestamp is invalid.');
  }
  if (!isRecord(parsed.household)) {
    return validationError('Backup household is missing or invalid.');
  }

  const rawHousehold = parsed.household;
  if (rawHousehold.currency !== 'LKR') {
    return validationError('Household currency must be LKR.');
  }
  if (
    typeof rawHousehold.id !== 'string' ||
    !rawHousehold.id.trim() ||
    typeof rawHousehold.name !== 'string' ||
    !rawHousehold.name.trim() ||
    rawHousehold.name.trim().length > 80 ||
    typeof rawHousehold.updatedAt !== 'string'
  ) {
    return validationError('Household profile is invalid.');
  }
  if (
    !Array.isArray(rawHousehold.members) ||
    !Array.isArray(rawHousehold.expenses) ||
    !Array.isArray(rawHousehold.repayments)
  ) {
    return validationError('Household records must be arrays.');
  }
  let deletedIds: string[] | undefined;
  if ('deletedIds' in rawHousehold) {
    if (
      !Array.isArray(rawHousehold.deletedIds) ||
      rawHousehold.deletedIds.some((id) => typeof id !== 'string' || !id.trim())
    ) {
      return validationError('Household deleted record IDs are invalid.');
    }
    deletedIds = [...new Set(rawHousehold.deletedIds)];
  }
  let categoryBudgetsCents: Record<string, number> | undefined;
  if ('categoryBudgetsCents' in rawHousehold) {
    if (!isRecord(rawHousehold.categoryBudgetsCents)) {
      return validationError('Household category budgets are invalid.');
    }
    categoryBudgetsCents = {};
    for (const [category, amount] of Object.entries(rawHousehold.categoryBudgetsCents)) {
      if (
        !['Groceries', 'Rent', 'Utilities', 'Other'].includes(category) ||
        typeof amount !== 'number' ||
        !Number.isSafeInteger(amount) ||
        amount <= 0 ||
        amount > MAX_AMOUNT_CENTS
      ) {
        return validationError('Household category budgets are invalid.');
      }
      categoryBudgetsCents[category] = amount;
    }
  }
  let themeAccent: SpaceAccent | undefined;
  if ('themeAccent' in rawHousehold) {
    if (
      rawHousehold.themeAccent !== 'cyan' &&
      rawHousehold.themeAccent !== 'emerald' &&
      rawHousehold.themeAccent !== 'amber' &&
      rawHousehold.themeAccent !== 'indigo'
    ) return validationError('Household theme accent is invalid.');
    themeAccent = rawHousehold.themeAccent;
  }
  if (rawHousehold.members.length > 30) {
    return validationError('Backup cannot contain more than 30 members.');
  }
  if (rawHousehold.expenses.length > 5000) {
    return validationError('Backup cannot contain more than 5000 expenses.');
  }
  if (rawHousehold.repayments.length > 5000) {
    return validationError('Backup cannot contain more than 5000 repayments.');
  }

  const memberIds = new Set<string>();
  const memberNames = new Set<string>();
  const members: Member[] = [];
  for (const member of rawHousehold.members) {
    if (
      !isRecord(member) ||
      typeof member.id !== 'string' ||
      !member.id.trim() ||
      typeof member.name !== 'string' ||
      !member.name.trim() ||
      member.name.trim().length > 80
    ) {
      return validationError('A member record is invalid.');
    }
    const normalizedName = member.name.trim().toLowerCase();
    if (memberIds.has(member.id)) {
      return validationError(`Duplicate member ID "${member.id}".`);
    }
    if (memberNames.has(normalizedName)) {
      return validationError(`Duplicate member name "${member.name.trim()}".`);
    }
    memberIds.add(member.id);
    memberNames.add(normalizedName);
    members.push({ id: member.id, name: member.name.trim() });
  }

  const expenseIds = new Set<string>();
  const expenses: Expense[] = [];
  let totalExpensesCents = 0;
  for (const expense of rawHousehold.expenses) {
    if (
      !isRecord(expense) ||
      typeof expense.id !== 'string' ||
      !expense.id.trim() ||
      typeof expense.title !== 'string' ||
      !expense.title.trim() ||
      expense.title.trim().length > 80 ||
      typeof expense.category !== 'string' ||
      !expense.category.trim() ||
      !isValidDate(expense.date) ||
      typeof expense.amountCents !== 'number' ||
      !Number.isSafeInteger(expense.amountCents) ||
      expense.amountCents <= 0 ||
      expense.amountCents > MAX_AMOUNT_CENTS ||
      typeof expense.paidById !== 'string' ||
      !memberIds.has(expense.paidById) ||
      (expense.splitMode !== 'equal' && expense.splitMode !== 'custom') ||
      !Array.isArray(expense.shares) ||
      expense.shares.length === 0
    ) {
      return validationError('An expense record is invalid.');
    }
    if (expenseIds.has(expense.id)) {
      return validationError(`Duplicate expense ID "${expense.id}".`);
    }
    expenseIds.add(expense.id);

    const nextTotal = safeAdd(totalExpensesCents, expense.amountCents);
    if (nextTotal === null) {
      return validationError('Expense totals exceed safe calculation limits.');
    }
    totalExpensesCents = nextTotal;

    const shareIds = new Set<string>();
    const shares: Share[] = [];
    let shareTotal = 0;
    for (const share of expense.shares) {
      if (
        !isRecord(share) ||
        typeof share.memberId !== 'string' ||
        !memberIds.has(share.memberId) ||
        typeof share.amountCents !== 'number' ||
        !Number.isSafeInteger(share.amountCents) ||
        share.amountCents < 0
      ) {
        return validationError('An expense share is invalid.');
      }
      if (shareIds.has(share.memberId)) {
        return validationError(
          `Expense "${expense.title}" contains duplicate member shares.`,
        );
      }
      shareIds.add(share.memberId);
      const nextShareTotal = safeAdd(shareTotal, share.amountCents);
      if (nextShareTotal === null) {
        return validationError('Expense share totals exceed safe calculation limits.');
      }
      shareTotal = nextShareTotal;
      shares.push({
        memberId: share.memberId,
        amountCents: share.amountCents,
      });
    }
    if (shareTotal !== expense.amountCents) {
      return validationError(
        `Expense "${expense.title}" shares do not match its amount.`,
      );
    }
    expenses.push({
      id: expense.id,
      title: expense.title.trim(),
      category: expense.category,
      amountCents: expense.amountCents,
      paidById: expense.paidById,
      date: expense.date,
      splitMode: expense.splitMode,
      shares,
    });
  }

  const repaymentIds = new Set<string>();
  const repayments: Repayment[] = [];
  let totalRepaymentsCents = 0;
  for (const repayment of rawHousehold.repayments) {
    if (
      !isRecord(repayment) ||
      typeof repayment.id !== 'string' ||
      !repayment.id.trim() ||
      !isValidDate(repayment.date) ||
      typeof repayment.fromId !== 'string' ||
      typeof repayment.toId !== 'string' ||
      repayment.fromId === repayment.toId ||
      !memberIds.has(repayment.fromId) ||
      !memberIds.has(repayment.toId) ||
      typeof repayment.amountCents !== 'number' ||
      !Number.isSafeInteger(repayment.amountCents) ||
      repayment.amountCents <= 0 ||
      repayment.amountCents > MAX_AMOUNT_CENTS
    ) {
      return validationError('A repayment record is invalid.');
    }
    if (repaymentIds.has(repayment.id)) {
      return validationError(`Duplicate repayment ID "${repayment.id}".`);
    }
    repaymentIds.add(repayment.id);

    const nextTotal = safeAdd(
      totalRepaymentsCents,
      repayment.amountCents,
    );
    if (nextTotal === null) {
      return validationError('Repayment totals exceed safe calculation limits.');
    }
    totalRepaymentsCents = nextTotal;
    repayments.push({
      id: repayment.id,
      fromId: repayment.fromId,
      toId: repayment.toId,
      amountCents: repayment.amountCents,
      date: repayment.date,
    });
  }
  if (safeAdd(totalExpensesCents, totalRepaymentsCents) === null) {
    return validationError('Household totals exceed safe calculation limits.');
  }

  return {
    ok: true,
    household: {
      id: rawHousehold.id,
      name: rawHousehold.name.trim(),
      currency: 'LKR',
      members,
      expenses,
      repayments,
      updatedAt: rawHousehold.updatedAt,
      ...(deletedIds ? { deletedIds } : {}),
      ...(categoryBudgetsCents ? { categoryBudgetsCents } : {}),
      ...(themeAccent ? { themeAccent } : {}),
    },
  };
}

export function exportBackupFile(household: Household): void {
  const backup = {
    app: 'RoomSplit',
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    household,
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const today = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `roomsplit-backup-${today}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

import type { Expense, Household, Share } from '../types';
import { calculateBalances, calculateTotalSpending, suggestRepayments } from './balances';
import type { MemberBalance, SuggestedTransfer } from './balances';
import { formatMoney } from './money';

export type ExpenseSummary = {
  period: string;
  billCount: number;
  totalCents: number;
  topCategory: string;
  categoryTotals: Record<string, number>;
};

const CATEGORIES = ['Groceries', 'Rent', 'Utilities', 'Other'];

function getIsoWeekRange(dateText: string): string {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  const day = (date.getUTCDay() + 6) % 7;
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - day);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return `${monday.toISOString().slice(0, 10)} to ${sunday.toISOString().slice(0, 10)}`;
}

function summarize(expenses: Expense[], keyFor: (expense: Expense) => string): ExpenseSummary[] {
  const groups = new Map<string, Expense[]>();
  for (const expense of expenses) {
    const key = keyFor(expense);
    const entries = groups.get(key) ?? [];
    entries.push(expense);
    groups.set(key, entries);
  }
  return [...groups.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([period, rows]) => {
    const categoryTotals: Record<string, number> = {};
    for (const expense of rows) {
      categoryTotals[expense.category] = (categoryTotals[expense.category] ?? 0) + expense.amountCents;
    }
    const topCategory = Object.entries(categoryTotals)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? '—';
    return {
      period,
      billCount: rows.length,
      totalCents: rows.reduce((sum, expense) => sum + expense.amountCents, 0),
      topCategory,
      categoryTotals,
    };
  });
}

export function buildWeeklyAndMonthlySummaries(expenses: Expense[]): {
  weekly: ExpenseSummary[];
  monthly: ExpenseSummary[];
} {
  return {
    weekly: summarize(expenses, (expense) => getIsoWeekRange(expense.date)),
    monthly: summarize(expenses, (expense) => expense.date.slice(0, 7)),
  };
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char] ?? char);
}

function table(headers: string[], rows: string[][]): string {
  return `<table><thead><tr>${headers.map((value) => `<th>${escapeHtml(value)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((value) => `<td>${escapeHtml(value)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function downloadFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function exportPdfReport(household: Household): void {
  const reportWindow = window.open('', '_blank');
  if (!reportWindow) {
    throw new Error('Allow pop-ups to open the printable expense report.');
  }
  const summaries = buildWeeklyAndMonthlySummaries(household.expenses);
  const balances = calculateBalances(household);
  const transfers = suggestRepayments(balances);
  const paidById = new Map(household.members.map((member) => [member.id, member.name]));
  const spending = calculateTotalSpending(household);
  const repaid = household.repayments.reduce((sum, repayment) => sum + repayment.amountCents, 0);
  const monthlyRows = summaries.monthly.map((row) => [
    row.period, String(row.billCount),
    ...CATEGORIES.map((category) => formatMoney(row.categoryTotals[category] ?? 0)),
    formatMoney(row.totalCents),
    formatMoney(Math.round(row.totalCents / Math.max(1, household.members.length))),
  ]);
  const weeklyRows = summaries.weekly.map((row) => [
    row.period, String(row.billCount), row.topCategory, formatMoney(row.totalCents),
  ]);
  const balanceRows = balances.map((balance) => [
    balance.name, formatMoney(balance.paidCents), formatMoney(balance.owedSharesCents),
    formatMoney(balance.balanceCents),
    balance.balanceCents > 0 ? 'Creditor' : balance.balanceCents < 0 ? 'Owes' : 'Settled',
  ]);
  const transferRows = transfers.map((transfer) => [
    `${transfer.fromName} pays ${transfer.toName}`, formatMoney(transfer.amountCents),
  ]);
  const expenseRows = [...household.expenses].sort((a, b) => a.date.localeCompare(b.date)).map((expense) => [
    expense.date, expense.title, expense.category, paidById.get(expense.paidById) ?? 'Unknown',
    expense.splitMode, expense.shares.map((share: Share) =>
      `${paidById.get(share.memberId) ?? 'Unknown'}: ${formatMoney(share.amountCents)}`,
    ).join('; '), formatMoney(expense.amountCents),
  ]);
  const styles = `body{font:14px Arial,sans-serif;color:#10243b;margin:32px}h1{color:#007d7b}h2{margin-top:28px;color:#10243b}p{color:#526174}table{width:100%;border-collapse:collapse;margin:12px 0 24px;font-size:12px}th,td{border:1px solid #dce4ec;padding:8px;text-align:left}th{background:#edf5f5}tr{break-inside:avoid}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.summary div{border:1px solid #dce4ec;border-radius:12px;padding:12px}@media print{body{margin:12mm}button{display:none}}`;
  reportWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(household.name)} Expense Report</title><style>${styles}</style></head><body><h1>WallyPad Expense Report</h1><p>${escapeHtml(household.name)} · Generated ${new Date().toLocaleDateString()}</p><h2>Executive Summary</h2><div class="summary"><div><b>Total spending</b><br>${formatMoney(spending)}</div><div><b>Total repaid</b><br>${formatMoney(repaid)}</div><div><b>Net unsettled balance</b><br>${formatMoney(transfers.reduce((sum, transfer) => sum + transfer.amountCents, 0))}</div></div><h2>Monthly Expense Summary</h2>${table(['Month', 'Bills', 'Groceries', 'Rent', 'Utilities', 'Other', 'Total Spend', 'Average per Member'], monthlyRows)}<h2>Weekly Expense Summary</h2>${table(['Week Date Range', 'Bills', 'Top Category', 'Total Weekly Spend'], weeklyRows)}<h2>Housemate Net Balances</h2>${table(['Member', 'Total Paid', 'Share Owed', 'Net Balance', 'Status'], balanceRows)}<h2>Suggested Settlements</h2>${table(['Transfer', 'Amount'], transferRows)}<h2>Itemized Expense Log</h2>${table(['Date', 'Title', 'Category', 'Payer', 'Split Mode', 'Participant Shares', 'Amount'], expenseRows)}<script>window.addEventListener('load',()=>window.print())</script></body></html>`);
  reportWindow.document.close();
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function exportCsvReport(household: Household): void {
  const members = new Map(household.members.map((member) => [member.id, member.name]));
  const rows = [
    ['Type', 'Date', 'Title', 'Category', 'Payer / From', 'To', 'Split Mode', 'Participant Shares', 'Amount LKR'],
    ...household.expenses.map((expense) => [
      'Expense', expense.date, expense.title, expense.category, members.get(expense.paidById) ?? '',
      '', expense.splitMode,
      expense.shares.map((share) => `${members.get(share.memberId) ?? share.memberId}: ${formatMoney(share.amountCents)}`).join('; '),
      (expense.amountCents / 100).toFixed(2),
    ]),
    ...household.repayments.map((repayment) => [
      'Repayment', repayment.date, 'Repayment', '', members.get(repayment.fromId) ?? '',
      members.get(repayment.toId) ?? '', '', '', (repayment.amountCents / 100).toFixed(2),
    ]),
  ];
  downloadFile(
    'wallypad-ledger.csv',
    `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`,
    'text/csv;charset=utf-8',
  );
}

export function buildWhatsAppSummary(household: Household): string {
  const transfers = suggestRepayments(calculateBalances(household));
  const total = calculateTotalSpending(household);
  const lines = [
    `🏠 *${household.name} — Settle Up*`,
    '',
    ...(transfers.length
      ? transfers.map((transfer) => `• ${transfer.fromName} → ${transfer.toName}: ${formatMoney(transfer.amountCents)}`)
      : ['• Everyone is settled up.']),
    '',
    `Total spend: ${formatMoney(total)}`,
  ];
  return lines.join('\n');
}

export type ShareSnapshot = {
  name: string;
  currency: 'LKR';
  balances: MemberBalance[];
  transfers: SuggestedTransfer[];
  totalSpendingCents: number;
};

export function encodeShareSnapshot(household: Household): string {
  const snapshot: ShareSnapshot = {
    name: household.name,
    currency: household.currency,
    balances: calculateBalances(household),
    transfers: suggestRepayments(calculateBalances(household)),
    totalSpendingCents: calculateTotalSpending(household),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function decodeShareSnapshot(param: string): ShareSnapshot {
  if (!/^[A-Za-z0-9_-]+$/.test(param) || param.length > 200_000) {
    throw new Error('Shared settlement snapshot is invalid.');
  }
  try {
    const base64 = param.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('Shared settlement snapshot is invalid.');
    }
    const snapshot = parsed as Record<string, unknown>;
    if (
      typeof snapshot.name !== 'string' || snapshot.currency !== 'LKR' ||
      !Array.isArray(snapshot.balances) || !Array.isArray(snapshot.transfers) ||
      typeof snapshot.totalSpendingCents !== 'number' ||
      !Number.isSafeInteger(snapshot.totalSpendingCents) || snapshot.totalSpendingCents < 0
    ) throw new Error('Shared settlement snapshot is invalid.');
    const balances: MemberBalance[] = [];
    for (const balance of snapshot.balances) {
      if (
        typeof balance !== 'object' || balance === null ||
        !('memberId' in balance) || typeof balance.memberId !== 'string' ||
        !('name' in balance) || typeof balance.name !== 'string' ||
        !('paidCents' in balance) || typeof balance.paidCents !== 'number' ||
        !('owedSharesCents' in balance) || typeof balance.owedSharesCents !== 'number' ||
        !('balanceCents' in balance) || typeof balance.balanceCents !== 'number' ||
        !Number.isSafeInteger(balance.paidCents) ||
        !Number.isSafeInteger(balance.owedSharesCents) ||
        !Number.isSafeInteger(balance.balanceCents)
      ) throw new Error('Shared settlement snapshot is invalid.');
      balances.push({
        memberId: balance.memberId,
        name: balance.name,
        paidCents: balance.paidCents,
        owedSharesCents: balance.owedSharesCents,
        balanceCents: balance.balanceCents,
      });
    }
    const transfers: SuggestedTransfer[] = [];
    for (const transfer of snapshot.transfers) {
      if (
        typeof transfer !== 'object' || transfer === null ||
        !('fromId' in transfer) || typeof transfer.fromId !== 'string' ||
        !('fromName' in transfer) || typeof transfer.fromName !== 'string' ||
        !('toId' in transfer) || typeof transfer.toId !== 'string' ||
        !('toName' in transfer) || typeof transfer.toName !== 'string' ||
        !('amountCents' in transfer) || typeof transfer.amountCents !== 'number' ||
        !Number.isSafeInteger(transfer.amountCents) || transfer.amountCents <= 0
      ) throw new Error('Shared settlement snapshot is invalid.');
      transfers.push({
        fromId: transfer.fromId,
        fromName: transfer.fromName,
        toId: transfer.toId,
        toName: transfer.toName,
        amountCents: transfer.amountCents,
      });
    }
    return {
      name: snapshot.name,
      currency: 'LKR',
      balances,
      transfers,
      totalSpendingCents: snapshot.totalSpendingCents,
    };
  } catch {
    throw new Error('Shared settlement snapshot is invalid.');
  }
}

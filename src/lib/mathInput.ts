import type { Share } from '../types';
import { parseMoney } from './money';
import { splitEqual } from './split';

type MoneyExpressionResult =
  | { ok: true; cents: number }
  | { ok: false; error: string };

export function evaluateMoneyExpression(rawInput: string): MoneyExpressionResult {
  const input = rawInput.trim();
  if (!input || !/^\d+(?:\.\d{1,2})?(?:\s*[+-]\s*\d+(?:\.\d{1,2})?)*$/.test(input)) {
    return { ok: false, error: 'Enter amounts with + or - (for example, 1200 + 50.25).' };
  }

  const terms = input.match(/[+-]?\s*\d+(?:\.\d{1,2})?/g);
  if (!terms) return { ok: false, error: 'Enter a valid amount expression.' };

  let total = 0;
  for (const term of terms) {
    const negative = term.trimStart().startsWith('-');
    const amount = term.replace(/[+-]/g, '').trim();
    const parsed = parseMoney(amount, { allowZero: true });
    if (parsed.ok === false) return { ok: false, error: parsed.error };
    total += negative ? -parsed.cents : parsed.cents;
    if (!Number.isSafeInteger(total)) return { ok: false, error: 'Amount exceeds safe calculation limits.' };
  }
  if (total < 0) return { ok: false, error: 'Total cannot be negative.' };
  if (total > 100_000_000) {
    return { ok: false, error: 'Amount cannot exceed LKR 1,000,000.00.' };
  }
  return { ok: true, cents: total };
}

export function buildSupermarketSplit(
  totalAmountCents: number,
  participantIds: string[],
  personalRawByMemberId: Record<string, string>,
): { ok: true; shares: Share[] } | { ok: false; error: string } {
  if (!Number.isSafeInteger(totalAmountCents) || totalAmountCents <= 0) {
    return { ok: false, error: 'Expense amount must be a positive cent value.' };
  }
  const uniqueIds = Array.from(new Set(participantIds));
  if (uniqueIds.length !== participantIds.length) {
    return { ok: false, error: 'Duplicate participants are not allowed.' };
  }
  if (uniqueIds.length === 0) {
    return { ok: false, error: 'Select at least one participant for the split.' };
  }

  const personalCents = new Map<string, number>();
  let personalTotal = 0;
  for (const memberId of uniqueIds) {
    const raw = personalRawByMemberId[memberId]?.trim() ?? '';
    if (!raw) continue;
    const result = evaluateMoneyExpression(raw);
    if (result.ok === false) return result;
    personalCents.set(memberId, result.cents);
    personalTotal += result.cents;
  }
  if (personalTotal > totalAmountCents) {
    return { ok: false, error: 'Personal items cannot exceed the expense total.' };
  }

  const sharedCents = totalAmountCents - personalTotal;
  const shared = sharedCents === 0
    ? { ok: true as const, shares: uniqueIds.map((memberId) => ({ memberId, amountCents: 0 })) }
    : splitEqual(sharedCents, uniqueIds);
  if (shared.ok === false) return shared;

  return {
    ok: true,
    shares: shared.shares.map((share) => ({
      memberId: share.memberId,
      amountCents: share.amountCents + (personalCents.get(share.memberId) ?? 0),
    })),
  };
}

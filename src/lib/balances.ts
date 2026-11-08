import type { Household } from '../types';

export type MemberBalance = {
  memberId: string;
  name: string;
  paidCents: number;
  owedSharesCents: number;
  balanceCents: number;
};

export type SuggestedTransfer = {
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  amountCents: number;
};

export function calculateTotalSpending(household: Household): number {
  return household.expenses.reduce((sum, exp) => sum + exp.amountCents, 0);
}

export function calculateBalances(household: Household): MemberBalance[] {
  const map = new Map<
    string,
    {
      name: string;
      paidCents: number;
      owedSharesCents: number;
      balanceCents: number;
    }
  >();

  for (const member of household.members) {
    map.set(member.id, {
      name: member.name,
      paidCents: 0,
      owedSharesCents: 0,
      balanceCents: 0,
    });
  }

  for (const exp of household.expenses) {
    const payer = map.get(exp.paidById);
    if (payer) {
      payer.paidCents += exp.amountCents;
      payer.balanceCents += exp.amountCents;
    }

    for (const share of exp.shares) {
      const participant = map.get(share.memberId);
      if (participant) {
        participant.owedSharesCents += share.amountCents;
        participant.balanceCents -= share.amountCents;
      }
    }
  }

  for (const rep of household.repayments) {
    const sender = map.get(rep.fromId);
    const receiver = map.get(rep.toId);
    if (sender) {
      sender.balanceCents += rep.amountCents;
    }
    if (receiver) {
      receiver.balanceCents -= rep.amountCents;
    }
  }

  return household.members.map((m) => {
    const stats = map.get(m.id)!;
    return {
      memberId: m.id,
      name: stats.name,
      paidCents: stats.paidCents,
      owedSharesCents: stats.owedSharesCents,
      balanceCents: stats.balanceCents,
    };
  });
}

export function suggestRepayments(
  balances: MemberBalance[],
): SuggestedTransfer[] {
  const debtors = balances
    .filter((b) => b.balanceCents < 0)
    .map((b) => ({
      memberId: b.memberId,
      name: b.name,
      remainingCents: -b.balanceCents,
    }))
    .sort(
      (a, b) =>
        b.remainingCents - a.remainingCents ||
        a.memberId.localeCompare(b.memberId),
    );

  const creditors = balances
    .filter((b) => b.balanceCents > 0)
    .map((b) => ({
      memberId: b.memberId,
      name: b.name,
      remainingCents: b.balanceCents,
    }))
    .sort(
      (a, b) =>
        b.remainingCents - a.remainingCents ||
        a.memberId.localeCompare(b.memberId),
    );

  const suggestions: SuggestedTransfer[] = [];
  let dIdx = 0;
  let cIdx = 0;

  while (dIdx < debtors.length && cIdx < creditors.length) {
    const debtor = debtors[dIdx];
    const creditor = creditors[cIdx];
    const transferCents = Math.min(
      debtor.remainingCents,
      creditor.remainingCents,
    );

    if (transferCents > 0) {
      suggestions.push({
        fromId: debtor.memberId,
        fromName: debtor.name,
        toId: creditor.memberId,
        toName: creditor.name,
        amountCents: transferCents,
      });
    }

    debtor.remainingCents -= transferCents;
    creditor.remainingCents -= transferCents;

    if (debtor.remainingCents === 0) dIdx++;
    if (creditor.remainingCents === 0) cIdx++;
  }

  return suggestions;
}

import type { Share } from '../types';
import { parseMoney } from './money';

export type SplitResult =
    | { ok: true; shares: Share[]; error?: undefined }
    | { ok: false; shares?: undefined; error: string };

export function splitEqual(
    amountCents: number,
    participantIds: string[]
): SplitResult {
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
        return { ok: false, error: 'Expense amount must be a positive cent value.' };
    }

    const uniqueIds = Array.from(new Set(participantIds));
    if (uniqueIds.length !== participantIds.length) {
        return { ok: false, error: 'Duplicate participants are not allowed.' };
    }

    const n = uniqueIds.length;
    if (n === 0) {
        return { ok: false, error: 'Select at least one participant for the split.' };
    }

    const sortedIds = [...uniqueIds].sort((a, b) => a.localeCompare(b));
    const base = Math.floor(amountCents / n);
    const remainder = amountCents % n;

    const shares: Share[] = sortedIds.map((memberId, index) => ({
        memberId,
        amountCents: index < remainder ? base + 1 : base,
    }));

    return { ok: true, shares };
}

export function buildCustomSplit(
    amountCents: number,
    participantIds: string[],
    rawSharesByMemberId: Record<string, string>
): SplitResult {
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
        return { ok: false, error: 'Enter a valid total expense amount first.' };
    }

    const uniqueIds = Array.from(new Set(participantIds));
    if (uniqueIds.length === 0) {
        return { ok: false, error: 'Select at least one participant for the split.' };
    }

    const shares: Share[] = [];
    let sumCents = 0;

    for (const memberId of uniqueIds) {
        const rawVal = rawSharesByMemberId[memberId] ?? '';
        const parsed = parseMoney(rawVal, { allowZero: true });
        if (parsed.ok === false) {
            return {
                ok: false,
                error: `Invalid custom share amount: ${parsed.error}`,
            };
        }
        shares.push({ memberId, amountCents: parsed.cents });
        sumCents += parsed.cents;
    }

    if (sumCents !== amountCents) {
        const diffCents = amountCents - sumCents;
        const diffRupees = (Math.abs(diffCents) / 100).toFixed(2);
        const direction =
            diffCents > 0
                ? `short by LKR ${diffRupees}`
                : `over by LKR ${diffRupees}`;
        return {
            ok: false,
            error: `Custom shares must add up to the expense total (${direction}).`,
        };
    }

    return { ok: true, shares };
}
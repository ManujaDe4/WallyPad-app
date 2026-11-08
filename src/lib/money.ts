export const MAX_AMOUNT_CENTS = 100_000_000; // LKR 1,000,000.00

export type MoneyParseResult =
  | { ok: true; cents: number; error?: undefined }
  | { ok: false; cents?: undefined; error: string };

export function parseMoney(
  rawInput: string,
  options: { allowZero?: boolean } = {},
): MoneyParseResult {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return { ok: false, error: 'Amount is required.' };
  }

  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return {
      ok: false,
      error:
        'Enter a valid amount using digits and up to 2 decimal places (e.g., 125.50).',
    };
  }

  const [wholePart, fracPart = ''] = trimmed.split('.');
  const paddedFrac = fracPart.padEnd(2, '0');

  const wholeNumber = Number(wholePart);
  const fracNumber = Number(paddedFrac);

  if (!Number.isSafeInteger(wholeNumber) || !Number.isSafeInteger(fracNumber)) {
    return { ok: false, error: 'Amount is too large.' };
  }

  const cents = wholeNumber * 100 + fracNumber;

  if (!Number.isSafeInteger(cents)) {
    return { ok: false, error: 'Amount exceeds safe calculation limits.' };
  }

  if (!options.allowZero && cents <= 0) {
    return { ok: false, error: 'Amount must be greater than LKR 0.00.' };
  }

  if (options.allowZero && cents < 0) {
    return { ok: false, error: 'Amount cannot be negative.' };
  }

  if (cents > MAX_AMOUNT_CENTS) {
    return { ok: false, error: 'Amount cannot exceed LKR 1,000,000.00.' };
  }

  return { ok: true, cents };
}

export function formatMoney(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const absRupees = Math.abs(cents) / 100;
  const formatted = new Intl.NumberFormat('en-LK', {
    style: 'currency',
    currency: 'LKR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(absRupees);

  return sign ? `${sign}${formatted}` : formatted;
}

export function centsToInputString(cents: number): string {
  const whole = Math.floor(Math.abs(cents) / 100);
  const frac = String(Math.abs(cents) % 100).padStart(2, '0');
  return `${whole}.${frac}`;
}

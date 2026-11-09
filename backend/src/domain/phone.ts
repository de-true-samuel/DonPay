/**
 * Normalise a Nigerian phone number to E.164 (+234XXXXXXXXXX).
 * Accepts "0803 123 4567", "08031234567", "2348031234567", "+234 803 123 4567", "8031234567".
 * Returns null when the input can't be a Nigerian mobile/landline number.
 */
export function normalizeNigerianPhone(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, '');
  let national: string;
  if (digits.startsWith('+234')) national = digits.slice(4);
  else if (digits.startsWith('234') && digits.length === 13) national = digits.slice(3);
  else if (digits.startsWith('0') && digits.length === 11) national = digits.slice(1);
  else if (/^[789]\d{9}$/.test(digits)) national = digits;
  else return null;
  if (national.startsWith('0')) national = national.slice(1);
  if (!/^[1-9]\d{9}$/.test(national)) return null;
  return `+234${national}`;
}

/** True when the token looks like someone typing a phone number into search. */
export function looksLikePhone(token: string): boolean {
  const d = token.replace(/[\s-]/g, '');
  return /^(\+?234|0)[789]\d{4,}$/.test(d);
}

/** Digits to search on for a partial phone like "0803" or "+234803" -> "803". */
export function phoneSearchDigits(token: string): string {
  let d = token.replace(/\D/g, '');
  if (d.startsWith('234')) d = d.slice(3);
  if (d.startsWith('0')) d = d.slice(1);
  return d;
}

/** "+2348031234567" -> "+234•••••4567" for logs. */
export function redactPhone(e164: string): string {
  if (e164.length < 8) return '•••';
  return `${e164.slice(0, 4)}•••••${e164.slice(-4)}`;
}

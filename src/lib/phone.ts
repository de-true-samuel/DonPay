/** "+2348031234567" → "0803 123 4567". Anything else is returned as given. */
export function formatPhone(e164: string): string {
  const m = /^\+234(\d{10})$/.exec(e164);
  if (!m) return e164;
  const d = '0' + m[1];
  return `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
}

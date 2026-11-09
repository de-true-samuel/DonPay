import { parseAmountQuery, type Kobo } from './money';
import { looksLikePhone, phoneSearchDigits } from './phone';

export interface ParsedSearch {
  text: string | null;
  phoneDigits: string | null;
  amountKobo: Kobo | null;
}

/**
 * Split a free-text search into the parts we can match precisely (phone, amount) and the
 * rest, which is matched loosely on customer name and service.
 */
export function parseSearchQuery(q: string | undefined | null): ParsedSearch {
  const result: ParsedSearch = { text: null, phoneDigits: null, amountKobo: null };
  if (!q) return result;
  const words: string[] = [];
  // Join "0803 123 4567"-style phone fragments before splitting.
  const compact = q.trim().replace(/(\+?\d)[\s-](?=\d{3})/g, '$1');
  for (const token of compact.split(/\s+/).filter(Boolean)) {
    if (!result.phoneDigits && looksLikePhone(token)) {
      result.phoneDigits = phoneSearchDigits(token);
      continue;
    }
    if (result.amountKobo == null) {
      const amount = parseAmountQuery(token);
      // A bare short number like "3" is more likely part of a name/service than ₦3.
      if (amount != null && (amount >= 100_00n || /[km₦]|^n/i.test(token))) {
        result.amountKobo = amount;
        continue;
      }
    }
    words.push(token);
  }
  result.text = words.length ? words.join(' ') : null;
  return result;
}

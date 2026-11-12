/**
 * Every piece of text that reaches a customer or provider is built here, from stored fields only.
 * Account details are never retyped by a human, so a typo can't send money to the wrong account.
 *
 * Paidar never contacts customers. Customer-facing text is PREPARED here and copied by the
 * provider; the frontend shows `text` exactly as returned, so this file is the single source of
 * wording (contract 1.1.0, BE-01). Customer messages come in English ("en") and Nigerian Pidgin
 * ("pcm"), chosen per customer (BE-12).
 */
import { formatNaira, formatNairaShort, koboToNairaString, type Kobo } from './money';
import { formatDueDay, formatLagosDateTime, formatLagosExpiry, formatMinutesLeft } from './time';
import type { RequestKind } from './request-state';

export type MessageLanguage = 'en' | 'pcm';

export interface PaymentDetails {
  bankName: string;
  accountNumber: string;
  accountName: string;
  amountKobo: number;
  amountPlain: string;
  expiresAt: string;
}

export interface PreparedMessage {
  text: string;
  whatsappUrl: string;
  telegramUrl: string;
  payLink: string;
  details: PaymentDetails | null;
  language: MessageLanguage;
}

const KIND_LABEL: Record<RequestKind, string> = {
  FULL: 'full payment',
  DEPOSIT: 'deposit',
  BALANCE: 'balance',
  CUSTOM: 'payment',
};

export function kindLabel(kind: RequestKind): string {
  return KIND_LABEL[kind];
}

/** "(deposit)" / "(balance)" where it tells the customer something; nothing for a full payment. */
function qualifier(kind: RequestKind | null): string {
  return kind === 'DEPOSIT' || kind === 'BALANCE' ? ` (${KIND_LABEL[kind]})` : '';
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

export const languageOf = (l: string | null | undefined): MessageLanguage => (l === 'pcm' ? 'pcm' : 'en');

export function shareLinks(phoneE164: string | null, text: string, payLink: string): Pick<PreparedMessage, 'whatsappUrl' | 'telegramUrl'> {
  const waTarget = phoneE164 ? phoneE164.replace(/^\+/, '') : '';
  return {
    whatsappUrl: `https://wa.me/${waTarget}?text=${encodeURIComponent(text)}`,
    telegramUrl: `https://t.me/share/url?url=${encodeURIComponent(payLink)}&text=${encodeURIComponent(text.replace(payLink, '').trim())}`,
  };
}

/** Account details for copy buttons. Values are identical to those embedded in the text. */
export function paymentDetails(i: { bankName: string; accountNumber: string; accountName: string; amountKobo: Kobo; expiresAt: Date }): PaymentDetails {
  return {
    bankName: i.bankName,
    accountNumber: i.accountNumber,
    accountName: i.accountName,
    amountKobo: Number(i.amountKobo),
    amountPlain: koboToNairaString(i.amountKobo),
    expiresAt: i.expiresAt.toISOString(),
  };
}

export interface RequestMessageInput {
  businessName: string;
  /** Used only for the WhatsApp link target. Never part of the text. */
  customerPhone: string;
  service: string;
  kind: RequestKind;
  amountKobo: Kobo;
  bankName: string;
  accountNumber: string;
  accountName: string;
  expiresAt: Date;
  payLink: string;
  language: MessageLanguage;
  now: Date;
}

const PAY_WORDS: Record<MessageLanguage, { pay: string; valid: string; link: string; expireIn: (t: string) => string }> = {
  en: {
    pay: 'Pay',
    valid: 'Valid until',
    link: 'Details and copy buttons',
    expireIn: (t) => `Your payment details expire in ${t}.`,
  },
  pcm: {
    pay: 'Abeg pay',
    valid: 'E go expire',
    link: 'Details and copy button dey here',
    expireIn: (t) => `Your payment details go expire in ${t}.`,
  },
};

/** The short template (Appendix A). */
export function paymentRequestMessage(i: RequestMessageInput): PreparedMessage {
  const w = PAY_WORDS[i.language];
  const text = [
    i.businessName,
    `${w.pay} ${formatNairaShort(i.amountKobo)} for ${i.service}${qualifier(i.kind)}`,
    `Bank: ${i.bankName}`,
    `Account number: ${i.accountNumber}`,
    `Account name: ${i.accountName}`,
    `${w.valid}: ${formatLagosExpiry(i.expiresAt, i.now)}`,
    `${w.link}: ${i.payLink}`,
  ].join('\n');
  return {
    text,
    payLink: i.payLink,
    details: paymentDetails(i),
    language: i.language,
    ...shareLinks(i.customerPhone, text, i.payLink),
  };
}

/** BE-07: "Your payment details expire in 10 minutes." Minutes computed from expiresAt at call time. */
export function nudgeMessage(i: RequestMessageInput): PreparedMessage {
  const w = PAY_WORDS[i.language];
  const text = [
    i.businessName,
    w.expireIn(formatMinutesLeft(i.expiresAt.getTime() - i.now.getTime())),
    `${w.pay} ${formatNairaShort(i.amountKobo)} for ${i.service}${qualifier(i.kind)}`,
    `Bank: ${i.bankName}`,
    `Account number: ${i.accountNumber}`,
    `Account name: ${i.accountName}`,
    `${w.link}: ${i.payLink}`,
  ].join('\n');
  return {
    text,
    payLink: i.payLink,
    details: paymentDetails(i),
    language: i.language,
    ...shareLinks(i.customerPhone, text, i.payLink),
  };
}

/** BE-08: sent by the provider once the job is ready to start. */
export function startMessage(i: {
  businessName: string;
  customerName: string;
  customerPhone: string;
  service: string;
  payLink: string;
  language: MessageLanguage;
}): PreparedMessage {
  const text =
    i.language === 'pcm'
      ? `Hi ${firstName(i.customerName)}, we don receive your payment for ${i.service}. We don start work. Thank you!\n${i.businessName}`
      : `Hi ${firstName(i.customerName)}, payment received for ${i.service}. We're starting. Thank you!\n${i.businessName}`;
  return { text, payLink: i.payLink, details: null, language: i.language, ...shareLinks(i.customerPhone, text, i.payLink) };
}

export interface ReceiptMessageInput {
  businessName: string;
  customerName: string;
  customerPhone: string;
  service: string;
  kind: RequestKind | null;
  amountKobo: Kobo;
  balanceKobo: Kobo;
  balanceDueAt: Date | null;
  paidAt: Date;
  payLink: string;
  language: MessageLanguage;
  now: Date;
}

export function receiptMessage(i: ReceiptMessageInput): PreparedMessage {
  const pcm = i.language === 'pcm';
  const amount = formatNaira(i.amountKobo);
  const lines = [
    pcm
      ? `Hi ${firstName(i.customerName)}, ${i.businessName} don receive your payment of ${amount} for ${i.service}${qualifier(i.kind)}. Thank you!`
      : `Hi ${firstName(i.customerName)}, ${i.businessName} has received your payment of ${amount} for ${i.service}${qualifier(i.kind)}. Thank you!`,
    `${pcm ? 'Time' : 'Paid'}: ${formatLagosDateTime(i.paidAt)}`,
  ];
  if (i.balanceKobo > 0n) {
    const due = i.balanceDueAt ? `, due ${formatDueDay(i.balanceDueAt, i.now)}` : '';
    lines.push(pcm ? `Balance wey remain: ${formatNaira(i.balanceKobo)}${due}.` : `Balance remaining: ${formatNaira(i.balanceKobo)}${due}.`);
  } else {
    lines.push(pcm ? 'You don pay everything for this job.' : 'This job is now fully paid.');
  }
  lines.push('', pcm ? 'Receipt dey here:' : 'Receipt:', i.payLink);
  const text = lines.join('\n');
  return { text, payLink: i.payLink, details: null, language: i.language, ...shareLinks(i.customerPhone, text, i.payLink) };
}

// ---- Provider-facing (Telegram) -------------------------------------------------------------

export interface PaidAlertInput {
  customerName: string;
  service: string;
  kind: RequestKind;
  amountKobo: Kobo;
  balanceKobo: Kobo;
  balanceDueAt: Date | null;
  readyToStart: boolean;
  becameReady: boolean;
  payerName: string | null;
  payerSimulated: boolean;
  flags: string[];
  now: Date;
}

/** "Paid ✔ ₦25,000 from Tolu for Bridal makeup. Deposit received. Ready to start." */
export function paidAlert(i: PaidAlertInput): string {
  const parts = [`Paid ✔ ${formatNairaShort(i.amountKobo)} from ${firstName(i.customerName)} for ${i.service}.`];
  if (i.balanceKobo > 0n) {
    parts.push(`${capitalise(kindLabel(i.kind))} received.`);
  } else {
    parts.push('Fully paid.');
  }
  if (i.readyToStart) parts.push(i.becameReady ? 'Ready to start ✔' : 'Already ready to start.');
  let text = parts.join(' ');
  if (i.balanceKobo > 0n) {
    text += `\nBalance ${formatNairaShort(i.balanceKobo)}${i.balanceDueAt ? ` due ${formatDueDay(i.balanceDueAt, i.now)}` : ''}.`;
  }
  const payer = i.payerName ? `${i.payerName}${i.payerSimulated ? ' (simulated)' : ''}` : 'unknown';
  text += `\nPayer name: ${payer}`;
  for (const f of i.flags) text += `\n⚠ ${f}`;
  return text;
}

export function balanceDuePrompt(i: { customerName: string; service: string; balanceKobo: Kobo; dueAt: Date; now: Date }): string {
  return `Balance due ${formatDueDay(i.dueAt, i.now)}: ${formatNairaShort(i.balanceKobo)} from ${firstName(i.customerName)} for ${i.service}.\nOpen the job to get payment details for the balance.`;
}

/** BE-04: the scheduled reminder. It creates no account. */
export function scheduledSendPrompt(i: { customerName: string; service: string; kind: RequestKind; amountKobo: Kobo; followUp?: boolean }): string {
  const lead = i.followUp ? 'Reminder from yesterday: ' : 'Time to ';
  const verb = i.followUp ? `${firstName(i.customerName)}'s ${kindLabel(i.kind)} request is still waiting` : `send ${firstName(i.customerName)}'s ${kindLabel(i.kind)} request`;
  return `${lead}${verb}: ${formatNairaShort(i.amountKobo)} for ${i.service}.\nOpen the job and tap "Get payment details". The account is created only then, so the customer gets the full time to pay.`;
}

/** BE-06: the customer tapped "I've paid". This is a claim, not a payment. */
export function customerClaimAlert(i: { customerName: string; service: string; amountKobo: Kobo }): string {
  return `${firstName(i.customerName)} says they have paid ${formatNairaShort(i.amountKobo)} for ${i.service}.\nWe are checking with the bank now. You will get a "Paid ✔" message only when the payment is confirmed. Don't start work on the claim alone.`;
}

export interface DigestInput {
  businessName: string;
  paidToday: { customerName: string; amountKobo: Kobo }[];
  waiting: { customerName: string; amountKobo: Kobo }[];
  followUps: { customerName: string; reason: string }[];
  needsReview: number;
}

export function dailyDigest(i: DigestInput): string {
  const lines = [`📋 Today at ${i.businessName}`];
  const paidTotal = i.paidToday.reduce((s, p) => s + p.amountKobo, 0n);
  lines.push(`Paid: ${i.paidToday.length}${i.paidToday.length ? ` (${formatNairaShort(paidTotal)})` : ''}`);
  for (const p of i.paidToday.slice(0, 5)) lines.push(`  ✔ ${firstName(p.customerName)} ${formatNairaShort(p.amountKobo)}`);
  lines.push(`Waiting: ${i.waiting.length}`);
  for (const w of i.waiting.slice(0, 5)) lines.push(`  ⏳ ${firstName(w.customerName)} ${formatNairaShort(w.amountKobo)}`);
  if (i.followUps.length) {
    lines.push('Follow up with:');
    for (const f of i.followUps.slice(0, 8)) lines.push(`  → ${firstName(f.customerName)}: ${f.reason}`);
  }
  if (i.needsReview) lines.push(`Needs review: ${i.needsReview}`);
  return lines.join('\n');
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

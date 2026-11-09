/**
 * Every piece of text that reaches a customer or provider is built here, from stored fields only.
 * Account details are never retyped by a human, so a typo can't send money to the wrong account.
 */
import { formatNaira, formatNairaShort, type Kobo } from './money';
import { formatDueDay, formatLagosDateTime } from './time';
import type { RequestKind } from './request-state';

export interface PreparedMessage {
  text: string;
  whatsappUrl: string;
  telegramUrl: string;
  payLink: string;
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

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

export function shareLinks(phoneE164: string | null, text: string, payLink: string): Omit<PreparedMessage, 'text' | 'payLink'> {
  const waTarget = phoneE164 ? phoneE164.replace(/^\+/, '') : '';
  return {
    whatsappUrl: `https://wa.me/${waTarget}?text=${encodeURIComponent(text)}`,
    telegramUrl: `https://t.me/share/url?url=${encodeURIComponent(payLink)}&text=${encodeURIComponent(text.replace(payLink, '').trim())}`,
  };
}

export interface RequestMessageInput {
  businessName: string;
  customerName: string;
  customerPhone: string;
  service: string;
  kind: RequestKind;
  amountKobo: Kobo;
  bankName: string;
  accountNumber: string;
  accountName: string;
  expiresAt: Date;
  payLink: string;
}

export function paymentRequestMessage(i: RequestMessageInput): PreparedMessage {
  const text = [
    `Hi ${firstName(i.customerName)}, here are the payment details from ${i.businessName} for ${i.service} (${kindLabel(i.kind)}):`,
    '',
    `Amount: ${formatNaira(i.amountKobo)} (pay this exact amount)`,
    `Bank: ${i.bankName}`,
    `Account number: ${i.accountNumber}`,
    `Account name: ${i.accountName}`,
    `Valid until: ${formatLagosDateTime(i.expiresAt)}`,
    '',
    'This account is for this payment only. Details & receipt:',
    i.payLink,
  ].join('\n');
  return { text, payLink: i.payLink, ...shareLinks(i.customerPhone, text, i.payLink) };
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
  now: Date;
}

export function receiptMessage(i: ReceiptMessageInput): PreparedMessage {
  const lines = [
    `Hi ${firstName(i.customerName)}, ${i.businessName} has received your payment of ${formatNaira(i.amountKobo)} for ${i.service}${i.kind ? ` (${kindLabel(i.kind)})` : ''}. Thank you!`,
    `Paid: ${formatLagosDateTime(i.paidAt)}`,
  ];
  if (i.balanceKobo > 0n) {
    lines.push(
      `Balance remaining: ${formatNaira(i.balanceKobo)}${i.balanceDueAt ? `, due ${formatDueDay(i.balanceDueAt, i.now)}` : ''}.`,
    );
  } else {
    lines.push('This job is now fully paid.');
  }
  lines.push('', 'Receipt:', i.payLink);
  const text = lines.join('\n');
  return { text, payLink: i.payLink, ...shareLinks(i.customerPhone, text, i.payLink) };
}

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
  return `Balance due ${formatDueDay(i.dueAt, i.now)}: ${formatNairaShort(i.balanceKobo)} from ${firstName(i.customerName)} for ${i.service}.\nTap below to send the balance request.`;
}

export function scheduledSendPrompt(i: { customerName: string; service: string; kind: RequestKind; amountKobo: Kobo }): string {
  return `Time to send ${firstName(i.customerName)}'s ${kindLabel(i.kind)} request: ${formatNairaShort(i.amountKobo)} for ${i.service}.\nThe account is created when you tap Send, so the customer gets the full time to pay.`;
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

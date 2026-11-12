/**
 * The customer payment page (BE-13). This page is the customer's entire experience of Paidar.
 *
 * - Server-rendered per state (waiting / paid / expired / cancelled / not ready / not found), so
 *   every detail is plain, selectable text that reads without JavaScript.
 * - No framework, inline styles, system fonts, well under 30 KB.
 * - Script only enhances: copy buttons, a countdown corrected by the server clock, status polling
 *   (4 s, then 10 s after two minutes, paused while hidden) and the "I've paid" button.
 * - Privacy: customer first name only, noindex, nothing about other requests.
 */
import { formatNaira } from '../domain/money';
import { formatDueDay, formatLagosDateTime, formatLagosExpiry } from '../domain/time';
import type { PublicRequest } from '../shared/contract';

export const PAY_PAGE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const QUALIFIER: Record<string, string> = { DEPOSIT: ' (deposit)', BALANCE: ' (balance)' };

const STYLE = `
:root{--bg:#f4f5f7;--card:#fff;--text:#111418;--muted:#4a5260;--line:#dde1e6;--ok:#0a6b40;--ok-bg:#e3f3ea;--warn:#7a4500;--warn-bg:#fdf0d9;--btn:#111418;--btn-text:#fff;--focus:#1b5fd1}
@media (prefers-color-scheme:dark){:root{--bg:#0e1013;--card:#181b20;--text:#f1f3f5;--muted:#aab2bd;--line:#2c323a;--ok:#5fd39a;--ok-bg:#12291d;--warn:#f3be6b;--warn-bg:#2d2312;--btn:#f1f3f5;--btn-text:#0e1013;--focus:#7fb0ff}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font:17px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:460px;margin:0 auto;padding:16px 16px 40px}
.biz{font-weight:700;font-size:19px;margin:4px 0 0}
.for{color:var(--muted);margin:2px 0 14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px}
.label{color:var(--muted);font-size:14px;margin:0}
.amount{font-size:34px;font-weight:750;letter-spacing:-.4px;margin:0 0 6px}
dl{margin:0}
.row{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:11px 0;border-top:1px solid var(--line)}
dt{color:var(--muted);font-size:15px;flex:none}
dd{margin:0;font-weight:650;text-align:right;word-break:break-word}
.sel{user-select:all;-webkit-user-select:all;font-variant-numeric:tabular-nums;letter-spacing:.5px}
.btns{display:grid;gap:10px;margin-top:14px}
button,.btn{display:flex;align-items:center;justify-content:center;width:100%;min-height:52px;padding:10px 16px;border-radius:12px;border:0;background:var(--btn);color:var(--btn-text);font:inherit;font-weight:650;text-decoration:none;cursor:pointer}
button.alt,.btn.alt{background:transparent;color:var(--text);border:2px solid var(--line)}
button:focus-visible,.btn:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
button[disabled]{opacity:.6}
.timer{margin-top:14px;padding:12px;border-radius:10px;background:var(--warn-bg);color:var(--warn);font-weight:650;text-align:center}
.notes{margin:16px 2px 0;font-size:15px}
.notes p{margin:0 0 10px}
.small{color:var(--muted);font-size:14px}
.badge{display:inline-block;padding:6px 12px;border-radius:999px;background:var(--ok-bg);color:var(--ok);font-weight:750;margin:0 0 10px}
h1{font-size:21px;margin:0 0 8px}
.js-only{display:none}
.js .js-only{display:flex}
.js div.js-only,.js section.js-only{display:block}
[hidden]{display:none!important}
`;

interface PageParts {
  title: string;
  body: string;
  script?: string;
}

function page(p: PageParts): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>${p.title}</title>
<style>${STYLE.trim()}</style>
</head>
<body>
<main>
${p.body}
</main>
${p.script ? `<script>${p.script}</script>` : ''}
</body>
</html>`;
}

function header(r: PublicRequest): string {
  return `<p class="biz">${esc(r.businessName)}</p>
<p class="for">For ${esc(r.customerFirstName)}: ${esc(r.service)}${QUALIFIER[r.kind] ?? ''}</p>`;
}

function contactButton(r: PublicRequest): string {
  if (!r.businessPhone) return '';
  const digits = r.businessPhone.replace(/^\+/, '');
  const text = encodeURIComponent(`Hi ${r.businessName}, it's ${r.customerFirstName} about my payment for ${r.service}.`);
  return `<div class="btns"><a class="btn" href="https://wa.me/${esc(digits)}?text=${text}" rel="noopener">Message ${esc(r.businessName)} on WhatsApp</a>
<a class="btn alt" href="tel:${esc(r.businessPhone)}">Call ${esc(r.businessPhone)}</a></div>`;
}

/** Shared client script: config is JSON (with "<" escaped) so it can't break out of the tag. */
function script(token: string, r: PublicRequest, state: string): string {
  const cfg = JSON.stringify({
    token,
    state,
    serverNow: Date.parse(r.serverNow),
    expiresAt: r.expiresAt ? Date.parse(r.expiresAt) : null,
    biz: r.businessName,
  }).replace(/</g, '\\u003c');
  return `(function(){
var C=${cfg},d=document,$=function(i){return d.getElementById(i)};
d.documentElement.className+=" js";
var offset=C.serverNow-Date.now(),start=Date.now(),timer=null;
function now(){return Date.now()+offset}
function tick(){var el=$("left");if(!el||!C.expiresAt)return;var ms=C.expiresAt-now();
if(ms<=0){el.textContent="Expired";location.reload();return}
var s=Math.floor(ms/1000),h=Math.floor(s/3600),m=Math.floor(s%3600/60);s=s%60;
el.textContent=(h?h+" h "+m+" min":m+" min "+(s<10?"0":"")+s+" s")+" left";setTimeout(tick,1000)}
function poll(){timer=null;if(d.hidden)return;
fetch("/p/"+encodeURIComponent(C.token)+"/status",{cache:"no-store"}).then(function(r){return r.ok?r.json():null}).then(function(s){
if(s){offset=Date.parse(s.serverNow)-Date.now();if(s.state!==C.state){location.reload();return}}schedule()},schedule)}
function schedule(){if(timer||d.hidden)return;timer=setTimeout(poll,Date.now()-start<120000?4000:10000)}
d.addEventListener("visibilitychange",function(){if(!d.hidden){clearTimeout(timer);timer=null;poll()}});
d.addEventListener("click",function(e){var b=e.target.closest&&e.target.closest("button[data-copy]");if(!b)return;
var v=b.getAttribute("data-copy"),label=b.getAttribute("data-label"),src=$(b.getAttribute("data-src"));
function done(t){b.textContent=t;setTimeout(function(){b.textContent=label},2000)}
function fallback(){if(src){var g=d.createRange();g.selectNodeContents(src);var sel=getSelection();sel.removeAllRanges();sel.addRange(g)}done("Selected: press and hold to copy")}
if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(v).then(function(){done("Copied \\u2713")},fallback)}else fallback()});
var cb=$("claimBtn");if(cb){setTimeout(function(){$("claim").hidden=false},60000);
cb.addEventListener("click",function(){cb.disabled=true;cb.textContent="Sending\\u2026";
fetch("/p/"+encodeURIComponent(C.token)+"/claim-paid",{method:"POST",headers:{"X-Requested-With":"kobo-exact"}}).then(function(){},function(){}).then(function(){
$("claim").innerHTML='<p><strong>Thanks. '+C.biz.replace(/[&<>]/g,"")+' has been told.</strong></p><p class="small">They will see your payment as soon as the bank confirms it. This page will update by itself.</p>'})})}
if(C.state==="waiting"){tick();schedule()}else if(C.state==="not_ready"){schedule()}
})();`;
}

export function renderPayPage(token: string, r: PublicRequest): string {
  const amount = formatNaira(BigInt(r.amountKobo));
  const now = new Date(r.serverNow);
  const biz = esc(r.businessName);

  if (r.status === 'SENT' && r.bankName && r.accountNumber && r.accountName && r.expiresAt) {
    const until = formatLagosExpiry(new Date(r.expiresAt), now);
    const acct = esc(r.accountNumber);
    const body = `${header(r)}
<section class="card" aria-label="Payment details">
<p class="label">Amount to pay</p>
<p class="amount" id="amt">${esc(amount)}</p>
<dl>
<div class="row"><dt>Bank</dt><dd>${esc(r.bankName)}</dd></div>
<div class="row"><dt>Account number</dt><dd class="sel" id="acct">${acct}</dd></div>
<div class="row"><dt>Account name</dt><dd>${esc(r.accountName)}</dd></div>
<div class="row"><dt>Pay before</dt><dd>${esc(until)}</dd></div>
</dl>
<div class="btns">
<button type="button" class="js-only" data-copy="${acct}" data-src="acct" data-label="Copy account number" aria-label="Copy account number ${acct}">Copy account number</button>
<button type="button" class="js-only alt" data-copy="${esc(r.amountPlain)}" data-src="amt" data-label="Copy amount (${esc(r.amountPlain)})" aria-label="Copy amount ${esc(r.amountPlain)}">Copy amount (${esc(r.amountPlain)})</button>
</div>
<div class="timer js-only" role="timer" aria-live="off" id="left">Valid until ${esc(until)}</div>
</section>
<div class="notes">
<p><strong>Pay exactly ${esc(amount)}.</strong> A different amount may be reversed by your bank.</p>
<p>Your bank app should show the account name <strong>${esc(r.accountName)}</strong>.</p>
<p>This account is for this payment only. Payment goes to ${biz} via Kora.</p>
<p class="small">This page updates by itself when your payment arrives.</p>
</div>
<section class="card" id="claim" hidden>
<p><strong>Already paid?</strong></p>
<button type="button" id="claimBtn" class="alt">Tell ${biz} I've paid</button>
<p class="small">This only lets ${biz} know to check. Your payment is confirmed when the bank confirms it, not by this button.</p>
</section>`;
    return page({ title: `Pay ${biz}: ${esc(amount)}`, body, script: script(token, r, 'waiting') });
  }

  if (r.status === 'PAID' && r.receipt) {
    const rc = r.receipt;
    const balance = BigInt(rc.jobBalanceKobo);
    const due = rc.balanceDueAt ? `, due ${esc(formatDueDay(new Date(rc.balanceDueAt), now))}` : '';
    const body = `${header(r)}
<section class="card" aria-label="Receipt">
<p class="badge">Payment received &#10003;</p>
<p class="amount">${esc(formatNaira(BigInt(rc.amountKobo)))}</p>
<dl>
<div class="row"><dt>Reference</dt><dd class="sel">${esc(rc.reference)}</dd></div>
<div class="row"><dt>Paid</dt><dd>${esc(formatLagosDateTime(new Date(rc.paidAt)))}</dd></div>
<div class="row"><dt>Paid to</dt><dd>${biz}</dd></div>
<div class="row"><dt>Job total</dt><dd>${esc(formatNaira(BigInt(rc.jobTotalKobo)))}</dd></div>
<div class="row"><dt>Balance</dt><dd>${balance > 0n ? `${esc(formatNaira(balance))}${due}` : 'Fully paid'}</dd></div>
</dl>
</section>
<div class="notes"><p class="small">Keep this page or take a screenshot as your receipt.</p></div>`;
    return page({ title: `Paid: ${biz}`, body });
  }

  const closed: Record<string, [string, string]> = {
    EXPIRED: ['These payment details have expired', `Please don't pay into this account. Ask ${biz} for new payment details.`],
    CANCELLED: ['This payment request was cancelled', `Please don't pay into this account. Contact ${biz} if you have questions.`],
    DRAFT: ["Payment details aren't ready yet", `${biz} hasn't created the account for this payment yet. Check back shortly.`],
    SCHEDULED: ["Payment details aren't ready yet", `${biz} hasn't created the account for this payment yet. Check back shortly.`],
  };
  const [title, text] = closed[r.status] ?? ['This payment is not available', `Contact ${biz}.`];
  const notReady = r.status === 'DRAFT' || r.status === 'SCHEDULED';
  const body = `${header(r)}
<section class="card">
<h1>${title}</h1>
<p>${text}</p>
${notReady ? '' : contactButton(r)}
</section>`;
  return page({ title: `${title}: ${biz}`, body, script: notReady ? script(token, r, 'not_ready') : undefined });
}

export function renderNotFoundPage(): string {
  return page({
    title: 'Payment link not found',
    body: `<section class="card"><h1>Payment link not found</h1><p>Check the link you were sent, or ask the business for new payment details.</p></section>`,
  });
}

/**
 * The customer payment page: bank details with copy buttons and a countdown, and it turns into the
 * receipt once paid. Server-rendered, no framework, tiny: built for cheap phones on slow networks.
 */
import { formatNaira } from '../domain/money';
import { kindLabel } from '../domain/messages';
import { formatLagosDateTime } from '../domain/time';
import type { PublicRequest } from '../shared/contract';

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function renderPayPage(token: string, r: PublicRequest): string {
  const amount = formatNaira(BigInt(r.amountKobo));
  const title = `${esc(r.businessName)} · ${amount}`;
  // Embed the state as JSON; "<" escaped so it can't close the script tag.
  const state = JSON.stringify(r).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--text:#14171c;--muted:#5d6673;--line:#e3e6ea;--accent:#0b7a4b;--accent-bg:#e6f4ed;--warn:#9a5b00;--warn-bg:#fdf3e1;--btn:#14171c;--btn-text:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#0f1114;--card:#181b20;--text:#eef0f3;--muted:#9aa3ae;--line:#2a2f36;--accent:#4cc38a;--accent-bg:#14291f;--warn:#f0b35a;--warn-bg:#2b2112;--btn:#eef0f3;--btn-text:#0f1114}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:440px;margin:0 auto;padding:20px 16px 40px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px}
.biz{font-weight:650;font-size:18px;margin:0}
.for{color:var(--muted);margin:2px 0 16px}
.amount{font-size:34px;font-weight:700;letter-spacing:-.5px;margin:0}
.exact{color:var(--muted);font-size:14px;margin:2px 0 18px}
.row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-top:1px solid var(--line)}
.label{color:var(--muted);font-size:13px}
.value{font-weight:600;font-size:17px;word-break:break-all}
button.copy{flex:none;border:1px solid var(--line);background:transparent;color:var(--text);border-radius:8px;padding:8px 12px;font:inherit;font-size:14px;cursor:pointer;min-height:40px}
button.copy:active{transform:scale(.97)}
.timer{margin-top:16px;padding:12px;border-radius:10px;background:var(--warn-bg);color:var(--warn);font-weight:600;text-align:center}
.status{text-align:center;padding:8px 0}
.badge{display:inline-block;padding:6px 12px;border-radius:999px;background:var(--accent-bg);color:var(--accent);font-weight:700}
.muted{color:var(--muted);font-size:14px}
.note{margin-top:18px;font-size:13px;color:var(--muted)}
dl{margin:16px 0 0}dl div{display:flex;justify-content:space-between;padding:8px 0;border-top:1px solid var(--line)}dt{color:var(--muted)}dd{margin:0;font-weight:600}
[hidden]{display:none!important}
</style>
</head>
<body>
<main>
  <div class="card">
    <p class="biz" id="biz"></p>
    <p class="for" id="for"></p>

    <section id="pay" hidden>
      <p class="amount" id="amount"></p>
      <p class="exact">Pay this exact amount from any bank app.</p>
      <div class="row"><div><div class="label">Bank</div><div class="value" id="bank"></div></div></div>
      <div class="row"><div><div class="label">Account number</div><div class="value" id="acct"></div></div><button class="copy" data-copy="acct">Copy</button></div>
      <div class="row"><div><div class="label">Account name</div><div class="value" id="acctName"></div></div></div>
      <div class="row"><div><div class="label">Amount</div><div class="value" id="amount2"></div></div><button class="copy" data-copy="amountPlain">Copy</button></div>
      <div class="timer" id="timer"></div>
      <p class="note">This account is for this payment only. This page updates by itself when your payment is confirmed.</p>
    </section>

    <section id="paid" hidden>
      <div class="status"><span class="badge">Paid ✔</span></div>
      <p class="muted" style="text-align:center" id="paidLine"></p>
      <dl>
        <div><dt>Receipt</dt><dd id="rcpRef"></dd></div>
        <div><dt>Amount paid</dt><dd id="rcpAmt"></dd></div>
        <div><dt>Date</dt><dd id="rcpDate"></dd></div>
        <div><dt>Job total</dt><dd id="rcpTotal"></dd></div>
        <div><dt>Balance remaining</dt><dd id="rcpBal"></dd></div>
      </dl>
    </section>

    <section id="closed" hidden>
      <div class="status"><p class="value" id="closedTitle"></p><p class="muted" id="closedText"></p></div>
    </section>
  </div>
</main>
<script>
(function(){
  var token = ${JSON.stringify(token)};
  var s = ${state};
  var fmt = function(k){ var n = BigInt(k), w = (n/100n).toString().replace(/\\B(?=(\\d{3})+(?!\\d))/g, ","), f = (n%100n).toString().padStart(2,"0"); return "\\u20a6" + w + "." + f; };
  var plain = function(k){ var n = BigInt(k); return (n/100n).toString() + (n%100n ? "." + (n%100n).toString().padStart(2,"0") : ""); };
  var when = function(iso){ return new Date(iso).toLocaleString("en-NG", { timeZone: "Africa/Lagos", hour: "numeric", minute: "2-digit", weekday: "short", day: "numeric", month: "short" }); };
  var $ = function(id){ return document.getElementById(id); };
  var kinds = ${JSON.stringify({ FULL: kindLabel('FULL'), DEPOSIT: kindLabel('DEPOSIT'), BALANCE: kindLabel('BALANCE'), CUSTOM: kindLabel('CUSTOM') })};
  var copyValues = {};
  function render(){
    $("biz").textContent = s.businessName;
    $("for").textContent = "For " + s.customerFirstName + ": " + s.service + " (" + kinds[s.kind] + ")";
    ["pay","paid","closed"].forEach(function(id){ $(id).hidden = true; });
    if (s.status === "SENT") {
      $("pay").hidden = false;
      $("amount").textContent = fmt(s.amountKobo); $("amount2").textContent = fmt(s.amountKobo);
      $("bank").textContent = s.bankName; $("acct").textContent = s.accountNumber; $("acctName").textContent = s.accountName;
      copyValues.acct = s.accountNumber; copyValues.amountPlain = plain(s.amountKobo);
    } else if (s.status === "PAID" && s.receipt) {
      $("paid").hidden = false;
      var r = s.receipt;
      $("paidLine").textContent = s.businessName + " has received your payment.";
      $("rcpRef").textContent = r.reference; $("rcpAmt").textContent = fmt(r.amountKobo); $("rcpDate").textContent = when(r.paidAt);
      $("rcpTotal").textContent = fmt(r.jobTotalKobo); $("rcpBal").textContent = r.jobBalanceKobo === "0" ? "Fully paid" : fmt(r.jobBalanceKobo);
    } else {
      $("closed").hidden = false;
      var t = { EXPIRED: ["This payment link has expired", "Ask " + s.businessName + " to send a new one. Don't pay into an expired account."],
                CANCELLED: ["This payment request was cancelled", "Please contact " + s.businessName + "."],
                DRAFT: ["Payment details aren't ready yet", "Please check back shortly."],
                SCHEDULED: ["Payment details aren't ready yet", "Please check back shortly."] }[s.status] || ["Unavailable", ""];
      $("closedTitle").textContent = t[0]; $("closedText").textContent = t[1];
    }
  }
  function tick(){
    if (s.status !== "SENT" || !s.expiresAt) return;
    var ms = new Date(s.expiresAt).getTime() - Date.now();
    if (ms <= 0) { s.status = "EXPIRED"; render(); return; }
    var m = Math.floor(ms/60000), sec = Math.floor(ms/1000)%60, h = Math.floor(m/60);
    $("timer").textContent = "Valid for " + (h ? h + "h " + (m%60) + "m" : m + "m " + String(sec).padStart(2,"0") + "s") + " · until " + when(s.expiresAt);
  }
  function poll(){
    if (s.status === "PAID" || s.status === "CANCELLED") return;
    fetch("/p/" + encodeURIComponent(token) + "/status", { cache: "no-store" }).then(function(r){ return r.ok ? r.json() : null; })
      .then(function(next){ if (next) { s = next; render(); } }).catch(function(){});
  }
  document.addEventListener("click", function(e){
    var b = e.target.closest && e.target.closest("button.copy"); if (!b) return;
    var v = copyValues[b.getAttribute("data-copy")]; if (!v) return;
    (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject()).then(function(){ b.textContent = "Copied ✔"; setTimeout(function(){ b.textContent = "Copy"; }, 1500); }, function(){ window.prompt("Copy:", v); });
  });
  render(); tick(); setInterval(tick, 1000); setInterval(poll, 5000);
})();
</script>
<noscript><main><p>${esc(r.businessName)}: ${esc(amount)}${r.status === 'SENT' && r.bankName ? ` · ${esc(r.bankName)} ${esc(r.accountNumber ?? '')} · valid until ${esc(r.expiresAt ? formatLagosDateTime(new Date(r.expiresAt)) : '')}` : ` · ${esc(r.status)}`}</p></main></noscript>
</body>
</html>`;
}

export function renderNotFoundPage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Not found</title>
<style>body{margin:0;font:16px system-ui,sans-serif;background:#f6f7f9;color:#14171c}@media (prefers-color-scheme:dark){body{background:#0f1114;color:#eef0f3}}main{max-width:440px;margin:0 auto;padding:40px 16px;text-align:center}</style></head>
<body><main><h1 style="font-size:20px">Payment link not found</h1><p>Check the link you were sent, or ask the business for a new one.</p></main></body></html>`;
}

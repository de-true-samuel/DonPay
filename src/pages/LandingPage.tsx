import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { waitlistApi } from '../api/endpoints';
import { useAuth } from '../auth/AuthProvider';
import { useDocumentTitle } from '../lib/hooks';
import { CountdownRing } from '../ui/CountdownRing';
import { Icon } from '../ui/Icon';
import { LogoMark } from '../ui/Logo';
import { Status } from '../ui/StatusChip';
import { TicketCard } from '../ui/TicketCard';

const FAQS = [
  {
    q: 'Do you hold my money?',
    a: 'No. Paidar never holds customer funds. Payments are processed through Kora’s banking infrastructure directly to your merchant settlement flow.',
  },
  {
    q: 'Can a client fake a payment?',
    a: 'No. Uploaded screenshots and “I’ve paid” taps never mark a request as paid. Paidar only marks a payment verified after Kora’s signed webhook and server-side requery confirm it.',
  },
  {
    q: 'Does it work with my bank?',
    a: 'Yes. Clients pay by ordinary Nigerian bank transfer from any bank app or USSD to the single-use virtual account shown on their payment page.',
  },
  {
    q: 'What does it cost?',
    a: 'Paidar is currently in open test mode during the Kora BuildInPublic hackathon. Standard Kora transfer fees apply when live.',
  },
  {
    q: 'What is test mode?',
    a: 'In test mode, virtual accounts and verifications run in sandbox so you can test the full payment-to-work flow without moving real money.',
  },
];

export function LandingPage() {
  useDocumentTitle('Paidar — Payment-to-Work Management');
  const { status } = useAuth();
  const ctaTarget = status === 'authed' ? '/app/new' : '/auth';

  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [bizType, setBizType] = useState('');
  const [waitlistErr, setWaitlistErr] = useState('');
  const [waitlistDone, setWaitlistDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  async function handleWaitlist(e: FormEvent) {
    e.preventDefault();
    const clean = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
      setWaitlistErr('Enter a valid email address.');
      return;
    }
    setWaitlistErr('');
    setSubmitting(true);
    try {
      await waitlistApi.join({
        email: clean,
        whatsappPhone: phone.trim() || undefined,
        businessType: (bizType || undefined) as never,
      });
      setWaitlistDone(true);
    } catch {
      setWaitlistErr('Could not join right now. Try again in a minute.');
    } finally {
      setSubmitting(false);
    }
  }

  const demoSent = new Date(Date.now() - 18 * 60_000).toISOString();
  const demoExp = new Date(Date.now() + 42 * 60_000).toISOString();

  return (
    <div style={{ minHeight: '100dvh', color: 'var(--ink-1)' }} data-flow-id="LND-00">
      {/* Sticky Glass Header */}
      <header className="pf-header" style={{ height: 72, padding: '0 24px', zIndex: 30 }}>
        <div style={{ maxWidth: 1280, width: '100%', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <a href="#top" data-flow-id="LND-01" style={{ display: 'inline-flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: 'var(--ink-1)', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 19, letterSpacing: '-0.03em' }}>
            <LogoMark size={28} />
            <span>paidar</span>
          </a>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Link to="/auth" data-flow-id="LND-02" className="pf-btn pf-btn--sm pf-btn--quiet">
              Log in
            </Link>
            <Link to={ctaTarget} data-flow-id="LND-03" className="pf-btn pf-btn--sm pf-btn--primary">
              Get started
            </Link>
          </div>
        </div>
      </header>

      <main id="top" style={{ maxWidth: 1280, margin: '0 auto', padding: '48px 20px 80px' }}>
        {/* Editorial Hero */}
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(310px, 1fr))', gap: 40, alignItems: 'center', marginBottom: 64 }}>
          <div>
            <div data-flow-id="LND-04" className="ob-status ob-status--solar" style={{ marginBottom: 20, borderRadius: 'var(--r-pill)' }}>
              <Icon name="flask" size={14} />
              <span>Paidar is in test mode. No real money moves yet.</span>
            </div>

            <h1
              data-flow-id="LND-05"
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 'clamp(36px, 5.2vw, 68px)',
                lineHeight: 0.98,
                letterSpacing: '-0.035em',
                color: 'var(--ink-1)',
                marginBottom: 20,
              }}
            >
              Stop trusting screenshots.{' '}
              <span
                style={{
                  background: 'var(--grad-volt)',
                  color: 'var(--volt-ink)',
                  padding: '2px 10px',
                  borderRadius: 'var(--r-sm)',
                  display: 'inline-block',
                }}
              >
                Get paid,
              </span>{' '}
              then know what to work on next.
            </h1>

            <p style={{ fontSize: 16, lineHeight: 1.55, color: 'var(--ink-2)', marginBottom: 28, maxWidth: 520 }}>
              Create a payment request, share it with your client, and let verified payment activity move the right job into your work queue.
            </p>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <Link to={ctaTarget} data-flow-id="LND-06" className="pf-btn pd-btn--hero pf-btn--primary">
                Create a payment request
              </Link>
              <Link to="/pay/demo" target="_blank" data-flow-id="LND-07" className="pf-btn pd-btn--hero pf-btn--secondary">
                See what your client sees
              </Link>
            </div>
          </div>

          {/* Single Hero Foil Signal Ticket Fragment */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <TicketCard
              hero
              state="waiting"
              title="Ada Obi · Brand identity package"
              subtitle="KORA DYNAMIC ACCOUNT · AFRICA/LAGOS"
              amountKobo="2500000"
              aside={<CountdownRing sentAt={demoSent} expiresAt={demoExp} size="sm" />}
              status={<Status tone="mint" icon="shield" label="Verified → Ready" />}
              footer={
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>
                  <span>WEMA · 9012345678</span>
                  <span>QUEUE #1 · 4H EST</span>
                </div>
              }
            />
          </div>
        </section>

        {/* 3-Step Explainer (LND-08) */}
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, marginBottom: 64 }} data-flow-id="LND-08">
          {[
            { step: '01 · CREATE', title: 'Four fields to a link', desc: 'Pick a client, describe the job, enter the amount in Naira, and set a due date.' },
            { step: '02 · SHARE', title: 'Send on WhatsApp', desc: 'Your client opens a clean mobile page with a single-use Kora transfer account—no login required.' },
            { step: '03 · VERIFIED', title: 'Work moves automatically', desc: 'When Kora confirms the transfer, Paidar issues a receipt and moves the job into your Ready queue.' },
          ].map((c) => (
            <div key={c.step} className="ob-tile" style={{ padding: 22 }}>
              <div className="ob-overline" style={{ color: 'var(--active-ink)', marginBottom: 8 }}>{c.step}</div>
              <h2 style={{ fontSize: 18, marginBottom: 8 }}>{c.title}</h2>
              <p style={{ color: 'var(--ink-2)', fontSize: 14 }}>{c.desc}</p>
            </div>
          ))}
        </section>

        {/* Waitlist (LND-10 to LND-13) */}
        <section className="ob-tile" style={{ maxWidth: 680, margin: '0 auto 56px', padding: 28 }}>
          <h2 style={{ fontSize: 22, marginBottom: 6 }}>Join the early-access waitlist</h2>
          <p style={{ color: 'var(--ink-2)', marginBottom: 20 }}>
            Get notified when live settlement opens for Nigerian service businesses.
          </p>

          {waitlistDone ? (
            <div role="status" className="ob-status ob-status--mint" style={{ width: '100%', padding: '14px 16px', fontSize: 14 }}>
              <Icon name="shield" size={18} />
              <span>You’re in. We’ll message you when your spot opens.</span>
            </div>
          ) : (
            <form onSubmit={(e) => void handleWaitlist(e)} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="pd-field">
                <label htmlFor="wl-email" className="pd-label">Email address</label>
                <input
                  id="wl-email"
                  type="email"
                  required
                  className="pd-input"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setWaitlistErr(''); }}
                  placeholder="tunde@studio.ng"
                  data-flow-id="LND-10"
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                <div className="pd-field">
                  <label htmlFor="wl-phone" className="pd-label">WhatsApp number (optional)</label>
                  <input
                    id="wl-phone"
                    type="tel"
                    className="pd-input"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="0803 123 4567"
                    data-flow-id="LND-11"
                  />
                </div>
                <div className="pd-field">
                  <label htmlFor="wl-type" className="pd-label">I am a… (optional)</label>
                  <select
                    id="wl-type"
                    className="pd-input"
                    value={bizType}
                    onChange={(e) => setBizType(e.target.value)}
                    data-flow-id="LND-12"
                  >
                    <option value="">Select business type</option>
                    <option value="CREATIVE_DESIGN">Freelancer / Creative</option>
                    <option value="DIGITAL_SERVICES">Agency / Studio</option>
                    <option value="REPAIRS_MAINTENANCE">Repairs & maintenance</option>
                    <option value="PRINTING_PRODUCTION">Production / printing</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>
              </div>

              {waitlistErr && (
                <p className="pd-error" role="alert">
                  <Icon name="alert" size={15} />
                  <span>{waitlistErr}</span>
                </p>
              )}

              <button type="submit" disabled={submitting} data-flow-id="LND-13" className="pf-btn pf-btn--primary" style={{ marginTop: 4 }}>
                {submitting ? 'Joining…' : 'Join the waitlist'}
              </button>
            </form>
          )}
        </section>

        {/* FAQ Accordion (LND-16) */}
        <section style={{ maxWidth: 680, margin: '0 auto 48px' }} data-flow-id="LND-16">
          <h2 style={{ fontSize: 22, marginBottom: 14 }}>Frequently asked questions</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {FAQS.map((item, i) => {
              const open = openFaq === i;
              return (
                <div key={item.q} className="ob-tile" style={{ overflow: 'hidden' }}>
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setOpenFaq(open ? null : i)}
                    style={{
                      width: '100%', textAlign: 'left', padding: '16px 20px', border: 0, background: 'transparent',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 600, fontSize: 15, cursor: 'pointer', color: 'var(--ink-1)',
                    }}
                  >
                    <span>{item.q}</span>
                    <Icon name={open ? 'x' : 'plus'} size={16} />
                  </button>
                  {open && (
                    <p style={{ padding: '0 20px 18px', color: 'var(--ink-2)', fontSize: 14 }}>
                      {item.a}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </main>

      <footer data-flow-id="LND-17" style={{ borderTop: '1px solid var(--line-1)', background: 'var(--bg-1)', padding: '24px 20px' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, fontSize: 13, color: 'var(--ink-3)' }}>
          <span>paidar · Payment verified. Work in motion.</span>
          <div style={{ display: 'flex', gap: 16 }}>
            <a href="https://github.com/de-true-samuel/DonPay" target="_blank" rel="noopener noreferrer">GitHub</a>
            <Link to="/pay/demo" target="_blank">Client Demo</Link>
            <Link to="/auth">Log in</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

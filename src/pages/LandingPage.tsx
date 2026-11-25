import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { waitlistApi } from '../api/endpoints';
import { useAuth } from '../auth/AuthProvider';
import { useDocumentTitle } from '../lib/hooks';
import { Icon } from '../ui/Icon';
import { LogoMark } from '../ui/Logo';

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

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg-canvas)', color: 'var(--text-primary)' }} data-flow-id="LND-00">
      {/* Header (76px) */}
      <header style={{
        background: '#FFFFFF', borderBottom: '1px solid var(--border-default)',
        height: 76, padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ maxWidth: 1200, width: '100%', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <a href="#top" data-flow-id="LND-01" style={{ display: 'inline-flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: 'var(--nav-bg)', fontWeight: 700, fontSize: 20 }}>
            <LogoMark size={28} />
            <span>paidar</span>
          </a>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Link to="/auth" data-flow-id="LND-02" style={{ textDecoration: 'none', color: 'var(--text-primary)', fontWeight: 600, fontSize: 14, padding: '10px 14px' }}>
              Log in
            </Link>
            <Link to={ctaTarget} data-flow-id="LND-03" className="pf-btn pf-btn--primary" style={{ height: 42 }}>
              Get started
            </Link>
          </div>
        </div>
      </header>

      <main id="top" style={{ maxWidth: 1160, margin: '0 auto', padding: '48px 20px 80px' }}>
        {/* Hero */}
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 40, alignItems: 'center', marginBottom: 40 }}>
          <div>
            <div data-flow-id="LND-04" style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 999,
              background: 'var(--status-warning-tint)', color: 'var(--status-warning)', border: '1px solid #F3D19E',
              fontSize: 12.5, fontWeight: 600, marginBottom: 18,
            }}>
              <Icon name="flask" size={14} />
              <span>Paidar is in test mode. No real money moves yet.</span>
            </div>

            <h1 data-flow-id="LND-05" style={{ fontSize: 'clamp(34px, 4.5vw, 56px)', lineHeight: 1.06, letterSpacing: '-0.025em', color: 'var(--nav-bg)', marginBottom: 18 }}>
              Stop trusting screenshots. Get paid, then know what to work on next.
            </h1>

            <p style={{ fontSize: 17, lineHeight: '26px', color: 'var(--text-secondary)', marginBottom: 28, maxWidth: 540 }}>
              Create a payment request, share it with your client, and let verified payment activity move the right job into your work queue.
            </p>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <Link to={ctaTarget} data-flow-id="LND-06" className="pf-btn pf-btn--primary" style={{ height: 48, padding: '0 22px', fontSize: 15 }}>
                Create a payment request
              </Link>
              <Link to="/pay/demo" target="_blank" data-flow-id="LND-07" className="pf-btn pf-btn--secondary" style={{ height: 48, padding: '0 20px', fontSize: 15 }}>
                See what your client sees
              </Link>
            </div>
          </div>

          {/* Real UI Fragment Preview */}
          <div style={{ background: 'var(--nav-bg)', borderRadius: 18, padding: 24, color: '#FFFFFF', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: '#94A3B8' }}>
              <span>PAYMENT → WORK</span>
              <span className="pd-mono">AFRICA/LAGOS</span>
            </div>

            <div style={{ background: '#FFFFFF', color: 'var(--text-primary)', borderRadius: 12, padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>KORA VERIFIED</span>
                <span style={{ background: 'var(--status-success-tint)', color: 'var(--status-success)', padding: '2px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600 }}>
                  Paid
                </span>
              </div>
              <div style={{ fontSize: 24, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>₦25,000.00</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>Ada Obi · Brand identity package</div>
            </div>

            <div style={{ background: 'var(--nav-hover)', borderRadius: 12, padding: 16, border: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>#1 in Next up Queue</span>
                <span style={{ background: 'rgba(83,104,248,0.22)', color: '#C7D2FE', padding: '2px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600 }}>
                  Ready to start
                </span>
              </div>
              <div style={{ fontSize: 12.5, color: '#CBD5E1', marginTop: 6 }}>
                Due tomorrow · 4h est. · 26h of 40h committed this week
              </div>
            </div>
          </div>
        </section>

        {/* 3-Step Explainer (LND-08) */}
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, marginBottom: 56 }} data-flow-id="LND-08">
          {[
            { step: '01 · Create', title: 'Four fields to a link', desc: 'Pick a client, describe the job, enter the amount in Naira, and set a due date.' },
            { step: '02 · Share', title: 'Send on WhatsApp', desc: 'Your client opens a clean mobile page with a single-use Kora transfer account—no login required.' },
            { step: '03 · Verified', title: 'Work moves automatically', desc: 'When Kora confirms the transfer, Paidar issues a receipt and moves the job into your Ready queue.' },
          ].map((c) => (
            <div key={c.step} className="pf-card">
              <div className="pd-mono" style={{ fontSize: 12, fontWeight: 600, color: 'var(--action-primary)', marginBottom: 8 }}>{c.step}</div>
              <h2 style={{ fontSize: 18, marginBottom: 6 }}>{c.title}</h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>{c.desc}</p>
            </div>
          ))}
        </section>

        {/* Waitlist (LND-10 to LND-13) */}
        <section className="pf-card" style={{ maxWidth: 680, margin: '0 auto 56px', padding: 28 }}>
          <h2 style={{ fontSize: 22, marginBottom: 6 }}>Join the early-access waitlist</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 18 }}>
            Get notified when live settlement opens for Nigerian service businesses.
          </p>

          {waitlistDone ? (
            <div role="status" style={{ background: 'var(--status-success-tint)', color: 'var(--status-success)', padding: '14px 16px', borderRadius: 9, fontWeight: 600 }}>
              You’re in. We’ll message you when your spot opens.
            </div>
          ) : (
            <form onSubmit={(e) => void handleWaitlist(e)} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label htmlFor="wl-email" style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Email address</label>
                <input
                  id="wl-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setWaitlistErr(''); }}
                  placeholder="tunde@studio.ng"
                  data-flow-id="LND-10"
                  style={{ width: '100%', height: 46, padding: '0 12px', borderRadius: 9, border: '1px solid var(--border-strong)' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                <div>
                  <label htmlFor="wl-phone" style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>WhatsApp number (optional)</label>
                  <input
                    id="wl-phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="0803 123 4567"
                    data-flow-id="LND-11"
                    style={{ width: '100%', height: 46, padding: '0 12px', borderRadius: 9, border: '1px solid var(--border-strong)' }}
                  />
                </div>
                <div>
                  <label htmlFor="wl-type" style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>I am a… (optional)</label>
                  <select
                    id="wl-type"
                    value={bizType}
                    onChange={(e) => setBizType(e.target.value)}
                    data-flow-id="LND-12"
                    style={{ width: '100%', height: 46, padding: '0 12px', borderRadius: 9, border: '1px solid var(--border-strong)', background: '#FFFFFF' }}
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

              {waitlistErr && <p style={{ color: 'var(--status-danger)', fontSize: 13 }}>{waitlistErr}</p>}

              <button type="submit" disabled={submitting} data-flow-id="LND-13" className="pf-btn pf-btn--primary" style={{ height: 48, marginTop: 4 }}>
                {submitting ? 'Joining…' : 'Join the waitlist'}
              </button>
            </form>
          )}
        </section>

        {/* FAQ Accordion (LND-16) */}
        <section style={{ maxWidth: 680, margin: '0 auto 48px' }} data-flow-id="LND-16">
          <h2 style={{ fontSize: 22, marginBottom: 14 }}>Frequently asked questions</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {FAQS.map((item, i) => {
              const open = openFaq === i;
              return (
                <div key={item.q} className="pf-card" style={{ padding: 0, overflow: 'hidden' }}>
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setOpenFaq(open ? null : i)}
                    style={{
                      width: '100%', textAlign: 'left', padding: '16px 20px', border: 0, background: 'transparent',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 600, fontSize: 15, cursor: 'pointer',
                    }}
                  >
                    <span>{item.q}</span>
                    <Icon name={open ? 'x' : 'plus'} size={16} />
                  </button>
                  {open && (
                    <p style={{ padding: '0 20px 16px', color: 'var(--text-secondary)', fontSize: 14 }}>
                      {item.a}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </main>

      <footer data-flow-id="LND-17" style={{ borderTop: '1px solid var(--border-default)', background: '#FFFFFF', padding: '24px 20px' }}>
        <div style={{ maxWidth: 1160, margin: '0 auto', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, fontSize: 13, color: 'var(--text-secondary)' }}>
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

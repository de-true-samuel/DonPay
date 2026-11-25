import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { publicApi } from '../api/endpoints';
import { formatNaira } from '../lib/money';
import { formatTime } from '../lib/time';
import { useDocumentTitle } from '../lib/hooks';
import { Icon } from '../ui/Icon';
import { LogoMark } from '../ui/Logo';

export function PublicReceiptPage() {
  const { token = '' } = useParams();
  const [copied, setCopied] = useState(false);

  const { data: receipt, isLoading, isError } = useQuery({
    queryKey: ['public-receipt', token],
    queryFn: () => publicApi.getReceipt(token),
    enabled: !!token,
    retry: false,
  });

  useDocumentTitle(receipt ? `Receipt · ${receipt.businessName}` : 'Payment receipt');

  async function copyRef(ref: string) {
    try {
      await navigator.clipboard.writeText(ref);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  }

  return (
    <main
      style={{
        minHeight: '100dvh',
        background: 'var(--bg-canvas)',
        padding: '24px 16px 48px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
      data-flow-id="RCT-00"
    >
      <div style={{ width: '100%', maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--nav-bg)', fontWeight: 700, fontSize: 17 }}>
            <LogoMark size={24} />
            <span>paidar</span>
          </div>
          {receipt?.isTestMode && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600,
              background: 'var(--status-warning-tint)', color: 'var(--status-warning)', border: '1px solid #F3D19E',
            }}>
              <Icon name="flask" size={14} />
              Test mode
            </span>
          )}
        </div>

        {isLoading && (
          <div style={{ background: '#FFFFFF', borderRadius: 14, padding: 28, border: '1px solid var(--border-default)' }}>
            <p style={{ color: 'var(--text-secondary)' }}>Loading verified receipt…</p>
          </div>
        )}

        {isError && (
          <div style={{ background: '#FFFFFF', borderRadius: 14, padding: 28, border: '1px solid var(--border-default)' }}>
            <h1 style={{ fontSize: 22, marginBottom: 8 }}>Receipt unavailable</h1>
            <p style={{ color: 'var(--text-secondary)' }}>
              A receipt is only issued after a payment has been verified. Check the payment link or contact the business if you need help.
            </p>
          </div>
        )}

        {receipt && (
          <article
            style={{
              background: '#FFFFFF',
              borderRadius: 14,
              padding: 24,
              border: '1px solid var(--border-default)',
              display: 'flex',
              flexDirection: 'column',
              gap: 20,
            }}
          >
            {receipt.status === 'refunded' && (
              <div
                role="alert"
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px',
                  borderRadius: 9, background: 'var(--status-danger-tint)', color: 'var(--status-danger)', fontWeight: 600,
                }}
              >
                <Icon name="refund" size={18} />
                <span>Refunded — this verified payment has been reversed.</span>
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '4px 10px', borderRadius: 8, marginBottom: 10,
                  background: receipt.status === 'refunded' ? 'var(--status-danger-tint)' : 'var(--status-success-tint)',
                  color: receipt.status === 'refunded' ? 'var(--status-danger)' : 'var(--status-success)',
                  fontSize: 12.5, fontWeight: 600,
                }}>
                  <Icon name={receipt.status === 'refunded' ? 'refund' : 'shield'} size={15} />
                  <span>{receipt.status === 'refunded' ? 'Payment refunded' : 'Payment verified'}</span>
                </div>
                <h1 style={{ fontSize: 32, lineHeight: '38px', fontVariantNumeric: 'tabular-nums' }}>
                  {formatNaira(receipt.acceptedAmountKobo)}
                </h1>
                <p style={{ color: 'var(--text-secondary)', marginTop: 4 }}>
                  Paid to <strong>{receipt.businessName}</strong>
                </p>
              </div>
            </div>

            <hr style={{ border: 0, borderTop: '1px solid var(--border-default)', margin: 0 }} />

            <dl style={{ display: 'grid', gridTemplateColumns: '1fr auto', rowGap: 12, columnGap: 16, margin: 0, fontSize: 13.5 }}>
              <dt style={{ color: 'var(--text-secondary)' }}>Service / Job</dt>
              <dd style={{ margin: 0, textAlign: 'right', fontWeight: 500 }}>{receipt.jobTitle}</dd>

              <dt style={{ color: 'var(--text-secondary)' }}>Client</dt>
              <dd style={{ margin: 0, textAlign: 'right', fontWeight: 500 }}>{receipt.clientName}</dd>

              <dt style={{ color: 'var(--text-secondary)' }}>Paid by</dt>
              <dd style={{ margin: 0, textAlign: 'right' }}>
                {receipt.payerName ? `${receipt.payerName}${receipt.payerBank ? ` · ${receipt.payerBank}` : ''}` : '—'}
              </dd>

              <dt style={{ color: 'var(--text-secondary)' }}>Date & time (Lagos)</dt>
              <dd style={{ margin: 0, textAlign: 'right' }}>{formatTime(receipt.paidAt)}</dd>

              {receipt.feeKobo && (
                <>
                  <dt style={{ color: 'var(--text-secondary)' }}>Processing fee</dt>
                  <dd style={{ margin: 0, textAlign: 'right' }}>{formatNaira(receipt.feeKobo)}</dd>
                </>
              )}

              <dt style={{ color: 'var(--text-secondary)' }}>Kora reference</dt>
              <dd style={{ margin: 0, textAlign: 'right', display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                <span className="pd-mono" style={{ fontSize: 12.5 }}>{receipt.koraReference}</span>
                <button
                  type="button"
                  onClick={() => copyRef(receipt.koraReference)}
                  aria-label="Copy Kora reference"
                  style={{
                    border: '1px solid var(--border-default)', background: 'var(--bg-surface-subtle)',
                    borderRadius: 6, padding: '4px 8px', fontSize: 12, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4,
                  }}
                >
                  <Icon name={copied ? 'check' : 'copy'} size={13} />
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
              </dd>

              <dt style={{ color: 'var(--text-secondary)' }}>Request ID</dt>
              <dd className="pd-mono" style={{ margin: 0, textAlign: 'right', fontSize: 12 }}>{receipt.requestReference}</dd>
            </dl>

            <div style={{ display: 'flex', gap: 10, paddingTop: 4 }} className="pf-no-print">
              <button
                type="button"
                onClick={() => window.print()}
                style={{
                  flex: 1, height: 44, borderRadius: 9, border: '1px solid var(--border-strong)',
                  background: '#FFFFFF', color: 'var(--text-primary)', fontWeight: 600, cursor: 'pointer',
                }}
              >
                Print receipt
              </button>
              {receipt.businessPhone && (
                <a
                  href={`https://wa.me/${receipt.businessPhone.replace(/\D/g, '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    flex: 1, height: 44, borderRadius: 9, border: 0,
                    background: 'var(--action-primary)', color: '#FFFFFF', fontWeight: 600,
                    textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  }}
                >
                  <Icon name="send" size={16} />
                  <span>Message business</span>
                </a>
              )}
            </div>
          </article>
        )}
      </div>
    </main>
  );
}

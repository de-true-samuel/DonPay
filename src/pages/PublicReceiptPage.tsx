import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { publicApi } from '../api/endpoints';
import { formatTime } from '../lib/time';
import { useDocumentTitle } from '../lib/hooks';
import { CopyChip } from '../ui/CopyChip';
import { Icon } from '../ui/Icon';
import { LogoMark } from '../ui/Logo';
import { Money } from '../ui/Money';
import { Status } from '../ui/StatusChip';

export function PublicReceiptPage() {
  const { token = '' } = useParams();

  const { data: receipt, isLoading, isError } = useQuery({
    queryKey: ['public-receipt', token],
    queryFn: () => publicApi.getReceipt(token),
    enabled: !!token,
    retry: false,
  });

  useDocumentTitle(receipt ? `Receipt · ${receipt.businessName}` : 'Payment receipt');

  return (
    <main
      style={{
        minHeight: '100dvh',
        padding: '24px 16px 48px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
      data-flow-id="RCT-00"
    >
      <div style={{ width: '100%', maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Header */}
        <div className="ob-no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ink-1)', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17, letterSpacing: '-0.03em' }}>
            <LogoMark size={24} />
            <span>paidar</span>
          </div>
          {receipt?.isTestMode && (
            <span className="ob-status ob-status--solar" style={{ borderRadius: 'var(--r-pill)', fontSize: 12 }}>
              <Icon name="flask" size={14} />
              <span>Test mode</span>
            </span>
          )}
        </div>

        {isLoading && (
          <div className="pd-receipt">
            <p style={{ color: 'var(--ink-2)' }}>Loading verified receipt…</p>
          </div>
        )}

        {isError && (
          <div className="pd-receipt">
            <h1 style={{ fontSize: 22, marginBottom: 8 }}>Receipt unavailable</h1>
            <p style={{ color: 'var(--ink-2)' }}>
              A receipt is only issued after a payment has been verified. Check the payment link or contact the business if you need help.
            </p>
          </div>
        )}

        {receipt && (
          <article className="pd-receipt" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {receipt.status === 'refunded' && (
              <div role="alert" className="ob-status ob-status--flare" style={{ width: '100%', padding: '12px 14px', whiteSpace: 'normal' }}>
                <Icon name="undo" size={18} />
                <span>Refunded — this verified payment has been reversed.</span>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <Status
                  tone={receipt.status === 'refunded' ? 'flare' : 'mint'}
                  icon={receipt.status === 'refunded' ? 'undo' : 'shield'}
                  label={receipt.status === 'refunded' ? 'Payment refunded' : 'Payment verified'}
                />
              </div>
              <Money
                kobo={receipt.acceptedAmountKobo}
                size="lg"
                tone={receipt.status === 'refunded' ? 'flare' : 'mint'}
              />
              <p style={{ color: 'var(--ink-2)' }}>
                Paid to <strong style={{ color: 'var(--ink-1)' }}>{receipt.businessName}</strong>
              </p>
            </div>

            <hr style={{ border: 0, borderTop: '1px solid var(--line-1)', margin: 0 }} />

            <dl style={{ display: 'grid', gridTemplateColumns: '1fr auto', rowGap: 14, columnGap: 16, margin: 0, fontSize: 13.5, alignItems: 'center' }}>
              <dt style={{ color: 'var(--ink-3)' }}>Service / Job</dt>
              <dd style={{ margin: 0, textAlign: 'right', fontWeight: 600, color: 'var(--ink-1)' }}>{receipt.jobTitle}</dd>

              <dt style={{ color: 'var(--ink-3)' }}>Client</dt>
              <dd style={{ margin: 0, textAlign: 'right', fontWeight: 600, color: 'var(--ink-1)' }}>{receipt.clientName}</dd>

              <dt style={{ color: 'var(--ink-3)' }}>Paid by</dt>
              <dd style={{ margin: 0, textAlign: 'right', color: 'var(--ink-1)' }}>
                {receipt.payerName ? `${receipt.payerName}${receipt.payerBank ? ` · ${receipt.payerBank}` : ''}` : '—'}
              </dd>

              <dt style={{ color: 'var(--ink-3)' }}>Date & time (Lagos)</dt>
              <dd className="pd-mono" style={{ margin: 0, textAlign: 'right', fontSize: 12.5, color: 'var(--ink-2)' }}>{formatTime(receipt.paidAt)}</dd>

              {receipt.feeKobo && (
                <>
                  <dt style={{ color: 'var(--ink-3)' }}>Processing fee</dt>
                  <dd style={{ margin: 0, textAlign: 'right' }}>
                    <Money kobo={receipt.feeKobo} size="sm" />
                  </dd>
                </>
              )}

              <dt style={{ color: 'var(--ink-3)' }}>Kora reference</dt>
              <dd style={{ margin: 0, textAlign: 'right', display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                <span className="pd-mono" style={{ fontSize: 12.5, color: 'var(--ink-1)', wordBreak: 'break-all' }}>{receipt.koraReference}</span>
                <CopyChip value={receipt.koraReference} label="Copy" copyLabel="Kora reference" className="ob-no-print" />
              </dd>

              <dt style={{ color: 'var(--ink-3)' }}>Request ID</dt>
              <dd className="pd-mono" style={{ margin: 0, textAlign: 'right', fontSize: 12, color: 'var(--ink-2)' }}>{receipt.requestReference}</dd>
            </dl>

            <div style={{ display: 'flex', gap: 10, paddingTop: 4 }} className="ob-no-print">
              <button
                type="button"
                className="pf-btn pf-btn--secondary"
                style={{ flex: 1 }}
                onClick={() => window.print()}
              >
                Print receipt
              </button>
              {receipt.businessPhone && (
                <a
                  href={`https://wa.me/${receipt.businessPhone.replace(/\D/g, '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="pf-btn pf-btn--primary"
                  style={{ flex: 1 }}
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

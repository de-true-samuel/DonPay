import { useDocumentTitle } from '../lib/hooks';
import { EmptyState, PhaseNote } from '../ui/primitives';

export function SearchPage() {
  useDocumentTitle('Search');
  return (
    <>
      <header className="pd-pagehead"><h1>Search</h1><p className="pd-sub">Find any customer, number or amount.</p></header>
      <div className="pd-field">
        <label className="pd-label" htmlFor="pd-s">Search</label>
        <input id="pd-s" className="pd-input" disabled placeholder="Tolu, 0803…, 25k" />
      </div>
      <EmptyState title="Search arrives soon">Type a name, a phone number or an amount and Paidar will find the job.</EmptyState>
      <PhaseNote phase={4}>search chips, saved views, review queue and CSV export.</PhaseNote>
    </>
  );
}

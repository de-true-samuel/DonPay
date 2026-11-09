import { useDocumentTitle } from '../lib/hooks';
import { EmptyState, LinkButton } from '../ui/primitives';

export function NotFoundPage() {
  useDocumentTitle('Not found');
  return (
    <EmptyState title="That page isn’t here" action={<LinkButton to="/today" variant="line">Back to Today</LinkButton>}>
      The link may be old, or the page may have moved.
    </EmptyState>
  );
}

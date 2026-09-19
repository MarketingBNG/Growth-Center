import { Suspense } from 'react';
import { BookCheck } from 'lucide-react';
import { PageHeader } from '@/components/patterns/page-header';
import { PageSkeleton } from '@/components/patterns/page-skeleton';
import { EmptyState, NoDatabaseState } from '@/components/patterns/state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatTile } from '@/components/patterns/stat-tile';
import { hasDb } from '@/lib/platform/prisma';
import { can } from '@/lib/access/roles';
import { currentUser } from '@/lib/access/auth';
import { listFacts } from '@/lib/content/facts-store';
import {
  FACT_STATUS_HINTS,
  FACT_STATUS_LABELS,
  factTone,
} from '@/lib/content/facts-fields';
import { fmtNumber } from '@/lib/shared/format';
import { FactRow } from './FactRow';
import { NewFactButton } from './NewFactButton';

export const metadata = { title: 'Facts · Growth Center' };

/**
 * The verified facts register and the review centre over it.
 *
 * Every tax number the firm publishes lives here and nowhere else. An article cites a fact
 * by key; the gate in lib/content/facts.ts refuses a draft whose figures do not resolve to
 * an approved row. So this page is not a reference table — it is the thing that decides
 * what may be said.
 *
 * Ordered by status, so what is waiting on a reviewer is at the top. That is the only
 * queue on the page and it is the page's whole job.
 */
export default function FactsPage() {
  return (
    <>
      <PageHeader
        title="Verified facts"
        subtitle="Every threshold, rate, deadline and form the firm publishes. Nothing else may be cited."
        actions={
          <Suspense fallback={null}>
            <FactsActions />
          </Suspense>
        }
      />
      <Suspense fallback={<PageSkeleton headless />}>
        <FactsBody />
      </Suspense>
    </>
  );
}

async function FactsActions() {
  if (!hasDb()) return null;
  const user = await currentUser();
  return can(user?.role, 'content:write') ? <NewFactButton /> : null;
}

async function FactsBody() {
  if (!hasDb()) {
    return <Card><NoDatabaseState /></Card>;
  }

  const [facts, user] = await Promise.all([listFacts(), currentUser()]);
  const canReview = can(user?.role, 'approve');
  const canWrite = can(user?.role, 'content:write');

  if (!facts.length) {
    return (
      <Card>
        <EmptyState
          icon={<BookCheck className="size-6" />}
          title="No facts entered yet"
          hint="Every figure in a published article has to resolve to an approved fact here. Until this register has entries, no draft carrying a number can pass the gate."
        />
      </Card>
    );
  }

  const count = (status: string) => facts.filter((f) => f.status === status).length;
  const waiting = facts.filter((f) => f.status === 'proposed');

  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <StatTile label="Approved" value={fmtNumber(count('approved'))} sub="Usable in a draft" />
        <StatTile label="Awaiting review" value={fmtNumber(waiting.length)} sub="Needs a CA or CPA" />
        <StatTile label="Draft" value={fmtNumber(count('draft'))} sub="Not yet submitted" />
        <StatTile label="Retired" value={fmtNumber(count('retired'))} sub="Superseded, kept for old articles" />
      </div>

      {/* The queue first, and only when there is one. A reviewer opening this page is
          here for these and nothing else. */}
      {waiting.length ? (
        <Card className="mb-4 border-warning/30">
          <CardHeader>
            <CardTitle>Waiting on a reviewer ({fmtNumber(waiting.length)})</CardTitle>
            <p className="text-xs text-muted-foreground">
              {canReview
                ? 'Check the value against the quoted source before clearing it. You cannot clear a fact you entered yourself.'
                : 'Only an owner can clear a fact. This is the CA/CPA sign-off.'}
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {waiting.map((f) => (
              <FactRow key={f.id} fact={f} canReview={canReview} canWrite={canWrite} expanded />
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>The register ({fmtNumber(facts.length)})</CardTitle>
          <div className="mt-1 flex flex-wrap gap-2">
            {Object.entries(FACT_STATUS_LABELS).map(([status, label]) => (
              <span key={status} className="text-meta text-muted-foreground" title={FACT_STATUS_HINTS[status]}>
                <Badge tone={factTone(status)}>{label}</Badge> {FACT_STATUS_HINTS[status]}
              </span>
            ))}
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {facts.map((f) => (
            <FactRow key={f.id} fact={f} canReview={canReview} canWrite={canWrite} />
          ))}
        </CardContent>
      </Card>
    </>
  );
}

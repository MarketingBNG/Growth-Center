'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { Kanban as KanbanIcon, Rows3 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { EmptyState } from '@/components/patterns/state';
import { SourceBadge } from '@/components/patterns/source-badge';
import { api } from '@/lib/fetcher';
import { fmtDate, fmtMoney, fmtNumber } from '@/lib/format';
import { DEMO_SOURCE } from '@/lib/sources';
import { ProgressLink } from '@/components/NavProgress';

/** Assigned by column position rather than by stage name, so a renamed or added stage
 *  still gets a colour instead of falling back to nothing. */
const STAGE_COLOR = [
  'bg-chart-1',
  'bg-chart-4',
  'bg-chart-6',
  'bg-chart-3',
  'bg-chart-2',
  'bg-chart-5',
] as const;

export type Deal = {
  id: string;
  name: string;
  value: number;
  probability: number;
  ownerEmail: string | null;
  /** Which system wrote the deal — a Zoho import, or the seeder. */
  source: string | null;
  expectedCloseDate: string | null;
  companyName: string | null;
  contactName: string | null;
};

export type Column = {
  stage: { id: string; name: string; probability: number; isWon: boolean; isLost: boolean };
  cards: Deal[];
  /** Every open deal in this stage. `cards` is capped, so the two differ on a busy stage
   *  and the header has to say which number it is showing. */
  total: number;
};

export function PipelineViews({
  columns,
  currency,
}: {
  columns: Column[];
  /** Reporting currency. Card values arrive already converted into it, because the board
   *  totals each column and a column cannot mix units. */
  currency?: string;
}) {
  const [view, setView] = useState<'board' | 'table'>('board');

  return (
    <>
      <div className="flex items-center gap-1 pb-4">
        <Button
          variant={view === 'board' ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setView('board')}
        >
          <KanbanIcon /> Board
        </Button>
        <Button
          variant={view === 'table' ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setView('table')}
        >
          <Rows3 /> Table
        </Button>
      </div>

      {view === 'board' ? (
        <Board columns={columns} currency={currency} />
      ) : (
        <DealTable columns={columns} currency={currency} />
      )}
    </>
  );
}

function Board({ columns, currency }: { columns: Column[]; currency?: string }) {
  const router = useRouter();
  // Local copy so a dropped card moves immediately; the server is the authority and
  // router.refresh() reconciles, but a card that visibly snaps back on every drop
  // makes the board feel broken.
  const [local, setLocal] = useState(columns);

  // The board is seeded from the server and then edited in place, so without this it kept
  // whatever it was first given: a range change, or coming back from a deal you had just
  // edited, re-rendered the page with fresh columns behind a board still showing the old
  // cards.
  //
  // Adjusted during render rather than from an effect, which is the shape React documents
  // for state derived from a prop. The effect version painted the stale board once before
  // correcting it — briefly showing the cards the server had just replaced.
  const [seeded, setSeeded] = useState(columns);
  if (seeded !== columns) {
    setSeeded(columns);
    setLocal(columns);
  }
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function drop(stageId: string) {
    const id = dragging;
    setDragging(null);
    setOver(null);
    if (!id) return;

    const from = local.find((c) => c.cards.some((d) => d.id === id));
    if (!from || from.stage.id === stageId) return;
    const deal = from.cards.find((d) => d.id === id)!;

    const previous = local;
    setLocal((cols) =>
      cols.map((c) => {
        if (c.stage.id === from.stage.id) {
          return { ...c, cards: c.cards.filter((d) => d.id !== id) };
        }
        if (c.stage.id === stageId) return { ...c, cards: [deal, ...c.cards] };
        return c;
      }),
    );

    try {
      await api(`/api/pipeline/opportunities/${id}`, { method: 'PATCH', json: { stageId } });
      setError(null);
      router.refresh();
    } catch (e) {
      setLocal(previous);
      setError((e as Error).message);
    }
  }

  return (
    <>
      {error ? (
        <p className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Could not move that deal: {error}
        </p>
      ) : null}

      <div className="grid items-start gap-3.5 pb-2 sm:grid-cols-2 lg:grid-cols-4">
        {local.map((col, colIndex) => {
          const sum = col.cards.reduce((t, d) => t + d.value, 0);
          return (
            <div
              key={col.stage.id}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(col.stage.id);
              }}
              onDragLeave={() => setOver((s) => (s === col.stage.id ? null : s))}
              onDrop={() => drop(col.stage.id)}
              className={`flex min-w-0 flex-col rounded-2xl border bg-card p-3.5 shadow-card transition-colors ${
                over === col.stage.id ? 'border-primary bg-primary/5' : 'border-border'
              }`}
            >
              <div className="flex items-baseline justify-between gap-2 pb-3">
                <div className="flex min-w-0 items-center gap-2">
                  {/* The stage's colour lives on this dot, not on the deal cards —
                      a whole column tinted by stage reads as a status, not a stage. */}
                  <span
                    aria-hidden
                    className={`size-2 shrink-0 rounded-full ${STAGE_COLOR[colIndex % STAGE_COLOR.length]}`}
                  />
                  <p className="truncate text-[13px] font-bold">{col.stage.name}</p>
                  {col.stage.isWon ? <Badge tone="success">won</Badge> : null}
                  {col.stage.isLost ? <Badge tone="danger">lost</Badge> : null}
                </div>
                {/* What this column is actually showing. A capped column used to print the
                    value of the cards on screen as though it were the stage's total. */}
                <p className="shrink-0 text-[11.5px] text-muted-foreground tnum">
                  {col.cards.length < col.total
                    ? `${fmtNumber(col.cards.length)} of ${fmtNumber(col.total)}`
                    : sum > 0
                      ? fmtMoney(sum, false, currency)
                      : col.cards.length}
                </p>
              </div>

              {/* Scrolls inside the column. With a real CRM behind it one stage can hold
                  hundreds of deals, and an unbounded column stretched the page so far
                  that the other three stages were off-screen. The drop target is this
                  box, so dragging into a scrolled column still works. */}
              <div className="-mr-1.5 max-h-[min(60vh,520px)] flex-1 space-y-2 overflow-y-auto pr-1.5">
                <AnimatePresence initial={false}>
                  {col.cards.map((deal) => (
                    <motion.div
                      key={deal.id}
                      layout
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      draggable
                      onDragStart={() => setDragging(deal.id)}
                      onDragEnd={() => setDragging(null)}
                      className={`cursor-grab rounded-xl border border-border bg-surface-sunken p-3 transition-colors hover:border-primary active:cursor-grabbing ${
                        dragging === deal.id ? 'opacity-40' : ''
                      }`}
                    >
                      <ProgressLink href={`/pipeline/${deal.id}`} className="block hover:text-primary">
                        <p className="break-words text-[12.5px] font-bold leading-[1.35]">
                          {deal.name}
                        </p>
                      </ProgressLink>
                      {deal.companyName ? (
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                          {deal.companyName}
                        </p>
                      ) : null}
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className="text-[13px] font-bold tnum">{fmtMoney(deal.value, false, currency)}</span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          <SourceBadge source={deal.source ?? DEMO_SOURCE} />
                          <span className="rounded-full bg-track px-2 py-0.5 text-[10.5px] font-bold text-muted-foreground tnum">
                            {deal.probability}%
                          </span>
                        </span>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>

                {col.cards.length === 0 ? (
                  <p className="px-1 py-4 text-center text-[11px] text-muted-foreground">
                    {/* A won or lost column is empty by definition — the board is the open
                        pipeline — so "Drag a deal here" needed to say what dropping one
                        there would do, rather than read as a stage with nothing in it. */}
                    {col.stage.isWon
                      ? 'Drop a deal here to mark it won'
                      : col.stage.isLost
                        ? 'Drop a deal here to mark it lost'
                        : 'Drag a deal here'}
                  </p>
                ) : null}
              </div>

            </div>
          );
        })}
      </div>
    </>
  );
}

function DealTable({ columns, currency }: { columns: Column[]; currency?: string }) {
  const rows = columns.flatMap((c) => c.cards.map((d) => ({ ...d, stageName: c.stage.name })));

  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState
          title="No open deals"
          hint="Convert a qualified lead to create the first opportunity."
        />
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <TableWrap>
        <Table>
          <THead>
            <TR>
              <TH>Deal</TH>
              <TH>Company</TH>
              <TH>Stage</TH>
              <TH className="text-right">Value</TH>
              <TH className="text-right">Prob.</TH>
              <TH>Owner</TH>
              <TH className="text-right">Expected close</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((d) => (
              <TR key={d.id}>
                <TD>
                  <span className="inline-flex items-center gap-1.5">
                    <ProgressLink href={`/pipeline/${d.id}`} className="font-medium hover:text-primary">
                      {d.name}
                    </ProgressLink>
                    <SourceBadge source={d.source ?? DEMO_SOURCE} />
                  </span>
                </TD>
                <TD className="text-muted-foreground">{d.companyName ?? '—'}</TD>
                <TD>
                  <Badge tone="info">{d.stageName}</Badge>
                </TD>
                <TD className="text-right tnum">{fmtMoney(d.value, false, currency)}</TD>
                <TD className="text-right text-muted-foreground tnum">{d.probability}%</TD>
                <TD className="text-muted-foreground">
                  {d.ownerEmail ? d.ownerEmail.split('@')[0] : '—'}
                </TD>
                <TD className="text-right text-muted-foreground">{fmtDate(d.expectedCloseDate)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </TableWrap>
    </Card>
  );
}

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { Kanban as KanbanIcon, Rows3 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { EmptyState } from '@/components/patterns/state';
import { api } from '@/lib/fetcher';
import { fmtDate, fmtMoney } from '@/lib/format';

export type Deal = {
  id: string;
  name: string;
  value: number;
  probability: number;
  ownerEmail: string | null;
  expectedCloseDate: string | null;
  companyName: string | null;
  contactName: string | null;
};

export type Column = {
  stage: { id: string; name: string; probability: number; isWon: boolean; isLost: boolean };
  cards: Deal[];
};

export function PipelineViews({ columns }: { columns: Column[] }) {
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

      {view === 'board' ? <Board columns={columns} /> : <DealTable columns={columns} />}
    </>
  );
}

function Board({ columns }: { columns: Column[] }) {
  const router = useRouter();
  // Local copy so a dropped card moves immediately; the server is the authority and
  // router.refresh() reconciles, but a card that visibly snaps back on every drop
  // makes the board feel broken.
  const [local, setLocal] = useState(columns);
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

      <div className="flex gap-3 overflow-x-auto pb-2">
        {local.map((col) => {
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
              className={`flex w-64 shrink-0 flex-col rounded-xl border bg-card/60 transition-colors ${
                over === col.stage.id ? 'border-primary bg-primary/5' : 'border-border'
              }`}
            >
              <div className="flex items-baseline justify-between border-b border-border px-3 py-2.5">
                <div className="flex items-center gap-1.5">
                  <p className="text-xs font-semibold">{col.stage.name}</p>
                  {col.stage.isWon ? <Badge tone="success">won</Badge> : null}
                  {col.stage.isLost ? <Badge tone="danger">lost</Badge> : null}
                </div>
                <p className="text-[11px] text-muted-foreground">{col.cards.length}</p>
              </div>

              <div className="flex-1 space-y-2 p-2">
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
                      className={`cursor-grab rounded-lg border border-border bg-card p-2.5 active:cursor-grabbing ${
                        dragging === deal.id ? 'opacity-40' : ''
                      }`}
                    >
                      <Link href={`/pipeline/${deal.id}`} className="block hover:text-primary">
                        <p className="text-sm font-medium leading-snug">{deal.name}</p>
                      </Link>
                      {deal.companyName ? (
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                          {deal.companyName}
                        </p>
                      ) : null}
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-xs font-semibold tnum">{fmtMoney(deal.value)}</span>
                        <span className="text-[11px] text-muted-foreground tnum">
                          {deal.probability}%
                        </span>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>

                {col.cards.length === 0 ? (
                  <p className="px-1 py-4 text-center text-[11px] text-muted-foreground">
                    Drag a deal here
                  </p>
                ) : null}
              </div>

              {sum > 0 ? (
                <div className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground tnum">
                  {fmtMoney(sum)}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </>
  );
}

function DealTable({ columns }: { columns: Column[] }) {
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
                  <Link href={`/pipeline/${d.id}`} className="font-medium hover:text-primary">
                    {d.name}
                  </Link>
                </TD>
                <TD className="text-muted-foreground">{d.companyName ?? '—'}</TD>
                <TD>
                  <Badge tone="info">{d.stageName}</Badge>
                </TD>
                <TD className="text-right tnum">{fmtMoney(d.value)}</TD>
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

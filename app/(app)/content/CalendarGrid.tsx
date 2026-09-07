'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { EditPieceModal, type EditablePiece } from './EditPieceModal';

export type CalendarCell = {
  /** `YYYY-MM-DD`, or null for the blanks that pad the grid out to whole weeks. */
  date: string | null;
  /** The day number, for the corner of the cell. */
  day: number | null;
  today: boolean;
  pieces: (EditablePiece & { imported: boolean; approved: boolean })[];
};

/** Monday first: the working week here runs Monday to Saturday, and a Sunday-first grid
 *  puts the first working day of the week in the middle of a row. */
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * A month of content, as weeks.
 *
 * The status board answers "what is in flight and who is holding it". It cannot answer
 * "what is going out on the 12th", which is the question a content calendar exists for,
 * and it was the only view this page had.
 *
 * Both views read the same ContentPiece rows — there is no second table of calendar
 * entries, because two tables would immediately disagree about what is scheduled.
 *
 * A piece is a button rather than a card with a button inside it: the whole tile opens the
 * editor, which is what anybody looking at a calendar tries first.
 */
const FORMAT_TONE: Record<string, 'neutral' | 'info' | 'success' | 'warning'> = {
  blog: 'info',
  video: 'warning',
  social: 'neutral',
  email: 'success',
  landing_page: 'info',
  case_study: 'success',
};

export function CalendarGrid({ weeks }: { weeks: CalendarCell[][] }) {
  const [editing, setEditing] = useState<EditablePiece | null>(null);

  return (
    <>
      <div className="overflow-x-auto pb-2">
        <div className="min-w-[52rem]">
          <div className="grid grid-cols-7 gap-1.5 pb-1.5">
            {WEEKDAYS.map((day) => (
              <p
                key={day}
                className="px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
              >
                {day}
              </p>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1.5">
            {weeks.flat().map((cell, i) => (
              <div
                key={cell.date ?? `pad-${i}`}
                className={[
                  'min-h-[7.5rem] rounded-xl border p-1.5',
                  // A padding day is not a day of this month, so it is not given the
                  // affordance of one — no border, no background, nothing to click.
                  cell.date === null
                    ? 'border-transparent'
                    : cell.today
                      ? 'border-primary/50 bg-card shadow-card'
                      : 'border-border bg-card',
                ].join(' ')}
              >
                {cell.day === null ? null : (
                  <>
                    <p
                      className={[
                        'px-0.5 pb-1 text-[11px] tnum',
                        cell.today ? 'font-semibold text-primary' : 'text-muted-foreground',
                      ].join(' ')}
                    >
                      {cell.day}
                    </p>
                    <div className="space-y-1">
                      {cell.pieces.map((piece) => (
                        <button
                          key={piece.id}
                          type="button"
                          onClick={() => setEditing(piece)}
                          className="block w-full rounded-lg border border-border bg-secondary/40 p-1.5 text-left transition-colors hover:bg-secondary"
                        >
                          <span className="flex items-start justify-between gap-1">
                            <span className="line-clamp-2 text-[11.5px] font-medium leading-snug">
                              {piece.title}
                            </span>
                            {piece.approved ? (
                              <span
                                className="mt-0.5 size-1.5 shrink-0 rounded-full bg-success"
                                title="Approved"
                                aria-label="Approved"
                              />
                            ) : null}
                          </span>
                          <span className="mt-1 flex flex-wrap items-center gap-1">
                            <Badge tone={FORMAT_TONE[piece.format] ?? 'neutral'}>
                              {piece.format.replaceAll('_', ' ')}
                            </Badge>
                            {piece.authorEmail ? (
                              <span className="text-[10px] text-muted-foreground">
                                {piece.authorEmail.split('@')[0]}
                              </span>
                            ) : null}
                          </span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <EditPieceModal piece={editing} open={editing !== null} onClose={() => setEditing(null)} />
    </>
  );
}

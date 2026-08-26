import { Hammer } from 'lucide-react';
import { PageHeader } from './page-header';

/** Honest placeholder for a module whose phase has not landed yet. Deliberately shows
 *  nothing that looks like data — an empty chart would read as "no results".
 *
 *  Dashed border rather than the solid card the built-out screens use: at a glance it
 *  reads as a gap in the product, not as a card that failed to load. */
export function ModulePending({
  title,
  subtitle,
  phase,
  planned,
}: {
  title: string;
  subtitle?: string;
  phase: string;
  planned: string[];
}) {
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />
      <div className="grid place-items-center gap-3 rounded-2xl border border-dashed border-border bg-card px-6 py-[72px] text-center">
        <span className="grid size-11 place-items-center rounded-xl bg-primary-soft text-primary">
          <Hammer className="size-5" />
        </span>
        <p className="text-[15px] font-bold">Not built yet — scheduled for {phase}</p>
        <div className="max-w-[460px] text-[12.5px] leading-[1.6] text-muted-foreground">
          <p>
            This route, its schema tables and its API are in place; the interface is not.
            Planned for this module:
          </p>
          <ul className="mt-2 text-left">
            {planned.map((p) => (
              <li key={p}>· {p}</li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}

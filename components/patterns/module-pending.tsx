import { Hammer } from 'lucide-react';
import { PageHeader } from './page-header';
import { Card } from '@/components/ui/card';
import { EmptyState } from './state';

/** Honest placeholder for a module whose phase has not landed yet. Deliberately shows
 *  nothing that looks like data — an empty chart would read as "no results". */
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
      <Card>
        <EmptyState
          icon={<Hammer className="size-6" />}
          title={`Not built yet — scheduled for ${phase}`}
          hint={
            <>
              This route, its schema tables and its API are in place; the interface is not.
              Planned for this module:
              <span className="mt-2 block text-left">
                {planned.map((p) => (
                  <span key={p} className="block">
                    · {p}
                  </span>
                ))}
              </span>
            </>
          }
        />
      </Card>
    </>
  );
}

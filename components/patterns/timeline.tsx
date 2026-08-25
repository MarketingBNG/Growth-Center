import { fmtRelative } from '@/lib/format';

type Entry = {
  id: string;
  type: string;
  summary: string;
  actorEmail: string | null;
  createdAt: Date;
};

const DOT: Record<string, string> = {
  created: 'bg-primary',
  status_changed: 'bg-chart-4',
  owner_changed: 'bg-chart-5',
  note_added: 'bg-muted-foreground',
  converted: 'bg-success',
  stage_changed: 'bg-chart-4',
  task_completed: 'bg-success',
  synced: 'bg-chart-3',
};

export function Timeline({ entries }: { entries: Entry[] }) {
  if (entries.length === 0) {
    return <p className="px-5 pb-5 text-xs text-muted-foreground">No history yet.</p>;
  }

  return (
    <ol className="relative space-y-4 px-5 pb-5">
      <span className="absolute left-[5px] top-1.5 bottom-1.5 w-px bg-border" aria-hidden />
      {entries.map((e) => (
        <li key={e.id} className="relative pl-5">
          <span
            className={`absolute left-0 top-1.5 size-[11px] rounded-full ring-3 ring-card ${DOT[e.type] ?? 'bg-muted-foreground'}`}
            aria-hidden
          />
          <p className="text-sm leading-snug">{e.summary}</p>
          <p className="text-[11px] text-muted-foreground">
            {e.actorEmail ? `${e.actorEmail.split('@')[0]} · ` : 'System · '}
            {fmtRelative(e.createdAt)}
          </p>
        </li>
      ))}
    </ol>
  );
}

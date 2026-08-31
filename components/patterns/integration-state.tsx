import { Badge } from '@/components/ui/badge';

// One mapping from state to how it is shown, so no page can invent a friendlier label
// for a connection that is not actually live.
const STATE: Record<string, { label: string; tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'purple' }> = {
  disconnected: { label: 'Not connected', tone: 'neutral' },
  connecting: { label: 'Connecting…', tone: 'info' },
  connected: { label: 'Connected', tone: 'success' },
  syncing: { label: 'Syncing…', tone: 'info' },
  // Not a stored state: cards() derives it when a run has held the sync lock past its
  // lease and is therefore dead rather than slow. The next sync will take the lock.
  sync_stalled: { label: 'Sync stalled', tone: 'warning' },
  error: { label: 'Error', tone: 'danger' },
  demo_data: { label: 'Demo data', tone: 'warning' },
};

/** The state in the same words the badge uses, so a caption beside a badge cannot
 *  disagree with it — "Not connected" was printed next to a "Syncing…" badge. */
export function stateLabel(state: string): string {
  return STATE[state]?.label ?? state;
}

export function StateBadge({ state }: { state: string }) {
  const s = STATE[state] ?? { label: state, tone: 'neutral' as const };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

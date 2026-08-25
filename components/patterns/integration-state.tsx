import { Badge } from '@/components/ui/badge';

// One mapping from state to how it is shown, so no page can invent a friendlier label
// for a connection that is not actually live.
const STATE: Record<string, { label: string; tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'purple' }> = {
  disconnected: { label: 'Not connected', tone: 'neutral' },
  connecting: { label: 'Connecting…', tone: 'info' },
  connected: { label: 'Connected', tone: 'success' },
  syncing: { label: 'Syncing…', tone: 'info' },
  error: { label: 'Error', tone: 'danger' },
  demo_data: { label: 'Demo data', tone: 'warning' },
};

export function StateBadge({ state }: { state: string }) {
  const s = STATE[state] ?? { label: state, tone: 'neutral' as const };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

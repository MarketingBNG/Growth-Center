import { Badge } from '@/components/ui/badge';

const LEAD_TONE = {
  new: 'info',
  contacted: 'purple',
  qualified: 'success',
  unqualified: 'neutral',
  converted: 'success',
  lost: 'danger',
} as const;

export function LeadStatusBadge({ status }: { status: keyof typeof LEAD_TONE }) {
  return <Badge tone={LEAD_TONE[status] ?? 'neutral'}>{status.replace('_', ' ')}</Badge>;
}

export function SourceBadge({ source }: { source: string }) {
  return <Badge tone="neutral">{source.replaceAll('_', ' ')}</Badge>;
}

const PRIORITY_TONE = { low: 'neutral', normal: 'info', high: 'warning', urgent: 'danger' } as const;

export function PriorityBadge({ priority }: { priority: keyof typeof PRIORITY_TONE }) {
  return <Badge tone={PRIORITY_TONE[priority] ?? 'neutral'}>{priority}</Badge>;
}

/** Shows where a number came from. Used wherever seeded demo rows sit next to real
 *  ones, so nobody mistakes seed data for a live figure. */
export function DemoBadge() {
  return <Badge tone="warning">Demo data</Badge>;
}

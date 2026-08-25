import { ModulePending } from '@/components/patterns/module-pending';

export const metadata = { title: 'Analytics · Growth Center' };

export default function Page() {
  return (
    <ModulePending
      title="Analytics"
      subtitle="One metrics layer across every connected source."
      phase="Phase 3"
      planned={['Traffic and conversion trends', 'Per-provider sections labelled by real connection state', 'Reads the shared MetricSnapshot table']}
    />
  );
}

import { ModulePending } from '@/components/patterns/module-pending';

export const metadata = { title: 'AI Insights · Growth Center' };

export default function Page() {
  return (
    <ModulePending
      title="AI Insights"
      subtitle="Analysis over Growth Center's own data."
      phase="Phase 4"
      planned={['Questions answered against live data', 'Explicit not-configured state when no API key is set', 'Seeded examples always labelled as samples']}
    />
  );
}

import { ModulePending } from '@/components/patterns/module-pending';

export const metadata = { title: 'Settings · Growth Center' };

export default function Page() {
  return (
    <ModulePending
      title="Settings"
      subtitle="Workspace configuration."
      phase="Phase 4"
      planned={['API keys for website lead capture', 'Channels and pipeline stages', 'Environment and connection health']}
    />
  );
}

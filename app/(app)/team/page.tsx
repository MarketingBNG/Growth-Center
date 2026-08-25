import { ModulePending } from '@/components/patterns/module-pending';

export const metadata = { title: 'Team · Growth Center' };

export default function Page() {
  return (
    <ModulePending
      title="Team"
      subtitle="Who has access, and what they can do."
      phase="Phase 4"
      planned={['The roster from lib/roles.ts', 'Role and permission matrix', 'Access is granted by editing the roster']}
    />
  );
}

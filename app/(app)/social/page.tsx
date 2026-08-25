import { ModulePending } from '@/components/patterns/module-pending';

export const metadata = { title: 'Social · Growth Center' };

export default function Page() {
  return (
    <ModulePending
      title="Social"
      subtitle="Accounts, reach and engagement."
      phase="Phase 4"
      planned={['Per-account followers, reach and engagement', 'Post-level performance', 'Publishing only once a publish API is actually connected']}
    />
  );
}

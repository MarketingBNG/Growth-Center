import { ModulePending } from '@/components/patterns/module-pending';

export const metadata = { title: 'Integrations · Growth Center' };

export default function Page() {
  return (
    <ModulePending
      title="Integrations"
      subtitle="Connect the platforms Growth Center reads from."
      phase="Phase 3"
      planned={['Zoho CRM, Meta Ads, Google Analytics and Semrush', 'Real connection state per provider — never a fake badge', 'Connect, disconnect, sync and error detail']}
    />
  );
}

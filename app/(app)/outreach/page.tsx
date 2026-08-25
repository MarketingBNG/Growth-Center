import { ModulePending } from '@/components/patterns/module-pending';

export const metadata = { title: 'Outreach · Growth Center' };

export default function Page() {
  return (
    <ModulePending
      title="Outreach"
      subtitle="Sequences, prospects and replies."
      phase="Phase 4"
      planned={['Sequences with steps and wait days', 'Prospect status and reply tracking', 'Sending behind a provider interface — console default']}
    />
  );
}

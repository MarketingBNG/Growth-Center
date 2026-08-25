import { ModulePending } from '@/components/patterns/module-pending';

export const metadata = { title: 'Tasks · Growth Center' };

export default function Page() {
  return (
    <ModulePending
      title="Tasks"
      subtitle="Follow-ups across leads, deals and accounts."
      phase="Phase 4"
      planned={['Assigned, due and overdue views', 'Created automatically when a lead qualifies', 'Linked to the record that produced them']}
    />
  );
}

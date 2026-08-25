import { ModulePending } from '@/components/patterns/module-pending';

export const metadata = { title: 'Pipeline · Growth Center' };

export default function Page() {
  return (
    <ModulePending
      title="Pipeline"
      subtitle="Opportunities from first conversation to won."
      phase="Phase 2"
      planned={['Kanban board with drag-to-change-stage', 'Table view with sorting and filters', 'Deal value, probability and expected close', 'Stage history']}
    />
  );
}

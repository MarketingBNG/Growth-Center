import { ModulePending } from '@/components/patterns/module-pending';

export const metadata = { title: 'CRM · Growth Center' };

export default function Page() {
  return (
    <ModulePending
      title="CRM"
      subtitle="Contacts and companies."
      phase="Phase 2"
      planned={['Contact and company records with full CRUD', 'Notes, activities and tasks per record', 'Tags and owners']}
    />
  );
}

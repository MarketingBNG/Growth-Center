import { ModulePending } from '@/components/patterns/module-pending';

export const metadata = { title: 'Leads · Growth Center' };

export default function Page() {
  return (
    <ModulePending
      title="Leads"
      subtitle="Every hand-raise, with the source that produced it."
      phase="Phase 2"
      planned={['Source, campaign, channel and UTM capture', 'Dedupe on email and domain', 'Qualification and owner assignment', 'Website form capture via the public API']}
    />
  );
}

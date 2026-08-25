import { ModulePending } from '@/components/patterns/module-pending';

export const metadata = { title: 'SEO · Growth Center' };

export default function Page() {
  return (
    <ModulePending
      title="SEO"
      subtitle="Keywords, rankings and the pages that earn them."
      phase="Phase 4"
      planned={['Tracked keywords with ranking history', 'Page-level clicks, impressions and position', 'Technical issues and opportunities']}
    />
  );
}

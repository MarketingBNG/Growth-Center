import { ModulePending } from '@/components/patterns/module-pending';

export const metadata = { title: 'Content · Growth Center' };

export default function Page() {
  return (
    <ModulePending
      title="Content"
      subtitle="From idea to published, with what it produced."
      phase="Phase 4"
      planned={['Idea, planned, draft, review, published, archived', 'Author, channel, campaign and publish date', 'Views and leads generated per piece']}
    />
  );
}

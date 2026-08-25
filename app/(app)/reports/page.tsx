import { ModulePending } from '@/components/patterns/module-pending';

export const metadata = { title: 'Reports · Growth Center' };

export default function Page() {
  return (
    <ModulePending
      title="Reports"
      subtitle="Growth reports built from the same numbers as the dashboard."
      phase="Phase 4"
      planned={['Executive, marketing, lead, sales and SEO reports', 'Reusable report sections', 'Export']}
    />
  );
}

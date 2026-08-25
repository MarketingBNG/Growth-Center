import { ModulePending } from '@/components/patterns/module-pending';

export const metadata = { title: 'Marketing · Growth Center' };

export default function Page() {
  return (
    <ModulePending
      title="Marketing"
      subtitle="Campaigns and channels, spend against return."
      phase="Phase 3"
      planned={['Spend, impressions, clicks and CTR by campaign', 'CAC and ROAS per channel', 'Date, channel and campaign filters']}
    />
  );
}

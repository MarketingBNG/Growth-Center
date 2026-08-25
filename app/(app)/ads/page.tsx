import { ModulePending } from '@/components/patterns/module-pending';

export const metadata = { title: 'Paid Ads · Growth Center' };

export default function Page() {
  return (
    <ModulePending
      title="Paid Ads"
      subtitle="Spend and return across ad platforms."
      phase="Phase 4"
      planned={['Meta Ads and Google Ads accounts', 'Campaign-level spend, CTR and cost per lead', 'Reads the same campaign metrics as Marketing']}
    />
  );
}

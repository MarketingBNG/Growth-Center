'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';

// §6.6's toggle. The constants and the argument for them are in lib/partner-view.ts,
// which a server component and the test runner can both read.

import { PARTNER_PARAM, PARTNER_VALUE } from '@/lib/partner-view';

export function PartnerViewToggle({ active }: { active: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function toggle() {
    const next = new URLSearchParams(params);
    if (active) next.delete(PARTNER_PARAM);
    else next.set(PARTNER_PARAM, PARTNER_VALUE);
    const query = next.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <Button
      variant={active ? 'secondary' : 'ghost'}
      size="sm"
      onClick={toggle}
      title={
        active
          ? 'Showing performance only. Owner names and per-person figures are hidden.'
          : 'Hide owner names and per-person figures, for a screen a partner will see.'
      }
    >
      {active ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      {active ? 'Partner view' : 'Partner view'}
    </Button>
  );
}

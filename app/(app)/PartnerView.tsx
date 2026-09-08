'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';

// §6.6's toggle. The constants and the argument for them are in lib/partner-view.ts,
// which a server component and the test runner can both read.

import { PARTNER_PARAM, PARTNER_VALUE } from '@/lib/partner-view';

/**
 * Partner view, held in the browser rather than fetched.
 *
 * It used to be a `router.push`, which is a full navigation: Next re-ran every query on
 * the dashboard — the band, the pipeline, the trend, channel performance, the segment
 * mix, delivery capacity, recent leads — before anything repainted. Measured at 3.4 to
 * 3.9 seconds a click, with no pending state, so it read as broken rather than slow.
 *
 * Nothing was being fetched that the page did not already have. The mode changes a line
 * of copy and whether one name per row is drawn; the names are in the payload either
 * way. This is presentation, not a privacy boundary — it exists so a partner glancing at
 * the screen sees performance rather than a staff scorecard, and anybody who can load
 * this page is on the roster already. So it flips in the client and repaints at once.
 *
 * The URL still carries it. `replaceState` keeps `?view=partner` shareable and
 * bookmarkable — a wall display can be pointed at it — without asking the server for a
 * page it has already sent. The param seeds the initial state on the way in.
 */
const PartnerViewContext = createContext<{ active: boolean; toggle: () => void } | null>(null);

export function PartnerViewProvider({
  initial,
  children,
}: {
  initial: boolean;
  children: React.ReactNode;
}) {
  const [active, setActive] = useState(initial);

  const toggle = useCallback(() => {
    setActive((was) => {
      const next = !was;
      // Guarded: this runs in the browser only, and a history write is not worth failing
      // a render over if the environment refuses it.
      try {
        const url = new URL(window.location.href);
        if (next) url.searchParams.set(PARTNER_PARAM, PARTNER_VALUE);
        else url.searchParams.delete(PARTNER_PARAM);
        window.history.replaceState(null, '', url);
      } catch {
        /* the mode still applies; only the shareable URL is missed */
      }
      return next;
    });
  }, []);

  const value = useMemo(() => ({ active, toggle }), [active, toggle]);
  return <PartnerViewContext.Provider value={value}>{children}</PartnerViewContext.Provider>;
}

/** False outside a provider, so a page that never opted in renders everything. */
export function usePartnerView() {
  return useContext(PartnerViewContext)?.active ?? false;
}

/** Wraps what a partner should not be shown. */
export function PartnerHidden({ children }: { children: React.ReactNode }) {
  return usePartnerView() ? null : <>{children}</>;
}

/** The page's subtitle, which says which mode the screen is in. */
export function PartnerViewSubtitle({ plain }: { plain: string }) {
  return usePartnerView()
    ? 'Performance only — owner names and per-person figures are hidden.'
    : plain;
}

export function PartnerViewToggle() {
  const ctx = useContext(PartnerViewContext);
  if (!ctx) return null;
  const { active, toggle } = ctx;

  return (
    <Button
      variant={active ? 'secondary' : 'ghost'}
      size="sm"
      onClick={toggle}
      aria-pressed={active}
      title={
        active
          ? 'Showing performance only. Owner names and per-person figures are hidden.'
          : 'Hide owner names and per-person figures, for a screen a partner will see.'
      }
    >
      {active ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      Partner view
    </Button>
  );
}

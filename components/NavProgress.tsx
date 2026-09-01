"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLinkStatus } from "next/link";

/**
 * The thin bar across the top of the window while a navigation is in flight.
 *
 * Every screen in this app is a dynamic server component, so a click is followed by a
 * round trip before anything can change on screen. Thirteen routes answer that with a
 * skeleton, but a skeleton only appears once the response starts streaming — and `crm`
 * and `pipeline` cannot have one at all, because a loading boundary on those segments
 * would flush a 200 over the 404s their detail routes raise. Until now those two gave no
 * acknowledgement of the click whatsoever.
 *
 * The bar covers the gap the skeletons cannot: it appears on the click itself, from the
 * router's own pending state rather than a guess at how long the page will take.
 */

type Ctx = { start: () => void; stop: () => void };

const NavProgressContext = createContext<Ctx | null>(null);

/**
 * Counted rather than a boolean. A click landing while another navigation is still
 * resolving would otherwise clear the bar on the first one's completion and leave the
 * second running with nothing on screen.
 */
export function NavProgressProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [pending, setPending] = useState(0);
  const value = useMemo<Ctx>(
    () => ({
      start: () => setPending((n) => n + 1),
      stop: () => setPending((n) => Math.max(0, n - 1)),
    }),
    [],
  );

  return (
    <NavProgressContext.Provider value={value}>
      <NavProgressBar active={pending > 0} />
      {children}
    </NavProgressContext.Provider>
  );
}

/**
 * Render inside a `<Link>` to report that link's pending state to the bar.
 *
 * `useLinkStatus` only works beneath a Link, which is why this is a component rather
 * than a hook called in the nav itself. It draws nothing.
 */
export function LinkProgress() {
  const { pending } = useLinkStatus();
  const ctx = useContext(NavProgressContext);
  const started = useRef(false);

  useEffect(() => {
    if (!ctx) return;
    if (pending && !started.current) {
      started.current = true;
      ctx.start();
    } else if (!pending && started.current) {
      started.current = false;
      ctx.stop();
    }
  }, [pending, ctx]);

  // Unmounting mid-navigation — which is what happens to the old page's links when the
  // new one arrives — must not leave the counter stuck above zero.
  useEffect(() => {
    return () => {
      if (started.current) {
        started.current = false;
        ctx?.stop();
      }
    };
  }, [ctx]);

  return null;
}

/**
 * The bar itself. No state and no effects — it is one element whose appearance follows a
 * single attribute, and the creep is a CSS animation in globals.css.
 *
 * An earlier version drove the width from a chain of four timers in an effect. It worked,
 * but it set state synchronously on every navigation, which is the pattern React's
 * set-state-in-effect rule exists to discourage, and it had already produced one bug: the
 * effect had depended on its own visibility, so hiding the bar cancelled the timer that
 * reset the width and left it stranded at 100%. There was nothing there worth holding in
 * React.
 */
function NavProgressBar({ active }: { active: boolean }) {
  return (
    <div
      // Progress that carries no number to announce, on a bar that repeats what the
      // skeleton beneath it already says. Announcing it would interrupt a screen reader
      // on every navigation to tell it nothing it is not about to be told again.
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-[2px]"
    >
      {/* `|| undefined` so the attribute is absent rather than data-active="false" —
          CSS attribute selectors match on presence. */}
      <div className="nav-progress h-full bg-primary" data-active={active || undefined} />
    </div>
  );
}

/** For non-Link navigations (router.push after a form submit, say). */
export function useNavProgress() {
  const ctx = useContext(NavProgressContext);
  return useCallback(
    (running: boolean) => (running ? ctx?.start() : ctx?.stop()),
    [ctx],
  );
}

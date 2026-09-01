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
 * Creeps toward 90% and waits there, because the real duration is unknown — the honest
 * shape for "still going" is one that never quite finishes. On completion it runs to
 * 100% and fades, so the end reads as an arrival rather than a disappearance.
 */
function NavProgressBar({ active }: { active: boolean }) {
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);

  // Keyed on `active` alone. An earlier version also depended on `visible`, so hiding the
  // bar re-ran the effect and its cleanup cancelled the timer that resets the width — the
  // bar stayed stranded at 100% and the next navigation had nowhere to grow from. The
  // e2e test in e2e/nav-progress.spec.ts is what caught it.
  useEffect(() => {
    if (active) {
      setVisible(true);
      setWidth(8);
      // Deliberately eased rather than linear: a linear crawl reads as a countdown and
      // invites the reader to predict an arrival the bar cannot promise.
      const timers = [
        setTimeout(() => setWidth(45), 60),
        setTimeout(() => setWidth(72), 300),
        setTimeout(() => setWidth(86), 900),
        setTimeout(() => setWidth(94), 2200),
      ];
      return () => timers.forEach(clearTimeout);
    }

    // Run to the end, then clear both together — width and visibility in one timer, so
    // there is no second one left to cancel.
    setWidth((w) => (w > 0 ? 100 : 0));
    const done = setTimeout(() => {
      setVisible(false);
      setWidth(0);
    }, 240);
    return () => clearTimeout(done);
  }, [active]);

  return (
    <div
      // Progress that carries no number to announce, on a bar that repeats what the
      // skeleton beneath it already says. Announcing it would interrupt a screen reader
      // on every navigation to tell it nothing it is not about to be told again.
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-[2px]"
    >
      <div
        className="h-full bg-primary transition-[width,opacity] duration-200 ease-out"
        style={{
          width: `${width}%`,
          opacity: visible ? 1 : 0,
          // A faint trailing glow, so the leading edge reads as motion on a 2px bar.
          boxShadow: visible ? "0 0 8px var(--primary)" : "none",
        }}
      />
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

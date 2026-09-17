/**
 * How long the specs wait, in one place.
 *
 * These were spread across the suite as bare numbers and had drifted apart: `goto` was
 * given 120s in fifteen places and 90s in two, the "page is real" wait 90s in most specs,
 * 120s in two and 60s in two, and four specs set no per-test budget at all and silently
 * ran on Playwright's 60s default.
 *
 * The spread was not a set of decisions — every one of these waits is there for the same
 * reason. In dev each route compiles on first hit, so the first spec to touch a page pays
 * a cost the next one does not, and it is unpredictable which spec that will be. A spec
 * that waits 60s for it is a spec that fails on a cold cache and passes on a warm one.
 *
 * Every value here is at or above what the spec using it had before, so unifying them
 * cannot make a test flakier than it already was.
 */

/** Loading a route, including its first compile. */
export const GOTO = 120_000;

/** Waiting for the shell to hydrate — `nav a` is the last thing to appear. */
export const HYDRATE = 120_000;

/** A whole test that visits one or two pages. Specs that loop over many set their own. */
export const SPEC = 180_000;

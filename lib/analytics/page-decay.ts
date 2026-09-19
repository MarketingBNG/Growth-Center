// Pages that used to earn and have stopped.
//
// Named page-decay rather than decay because lib/pipeline/decay.ts already owns that word
// for a different idea — a deal's probability ageing as it goes quiet. This is a page
// losing search traffic it used to have, and the two must not be confused in an import.
//
// Pure, and deliberately so: it takes windows and thresholds and returns findings. The
// reading lives in lib/analytics/seo.ts. That is what makes the judgement testable on
// fixtures without a database, which is what the spec asks for.

/**
 * How long a stored window covers.
 *
 * Not a choice this module makes. The Search Console sync asks for a range and writes each
 * page's totals for the whole of it, stamped with the range's last day, so a `seo_page`
 * row is "what this URL earned over the preceding 28 days as of that date". The detector
 * has to know that to compare two of them without overlapping.
 */
export const WINDOW_DAYS = 28;

/** One stored window for one URL: what it earned over the 28 days ending on `date`. */
export type PageWindow = {
  date: Date;
  clicks: number;
  impressions: number;
  /** Search Console's average position, or null where it reported none. */
  position: number | null;
};

export type DecayLimits = {
  /** Percentage fall in clicks that counts as decay. */
  clicksDrop: number;
  /** A page inside this position and no longer inside it has left the first page. */
  positionFloor: number;
  /** Below this many impressions in both windows, the page is not judged. */
  impressionFloor: number;
};

export type DecayFinding = {
  url: string;
  /** Which test tripped. `both` is worse than either and is ordered as such. */
  reason: 'clicks' | 'position' | 'both';
  clicksBefore: number;
  clicksNow: number;
  /** Clicks lost between the two windows. Never negative — a rise is not a finding. */
  clicksLost: number;
  /** The fall as a percentage of what the page used to earn, or null where it earned
   *  nothing to fall from. */
  dropPercent: number | null;
  positionBefore: number | null;
  positionNow: number | null;
  /** The two days compared, so a finding can say what it looked at. */
  from: Date;
  to: Date;
};

const DAY_MS = 86_400_000;

/**
 * Finds the window to compare the newest one against.
 *
 * The newest window at least WINDOW_DAYS older than the current one, so the two cover
 * separate stretches of time. Anything closer overlaps: two windows a week apart share
 * three weeks of the same days, and the "fall" between them is mostly the same traffic
 * counted twice. That comparison would report decay on a page that had merely had one
 * quiet week, and miss a page that had slid steadily for a month.
 */
function priorWindow(windows: PageWindow[], current: PageWindow): PageWindow | null {
  const cutoff = current.date.getTime() - WINDOW_DAYS * DAY_MS;
  let best: PageWindow | null = null;
  for (const w of windows) {
    if (w.date.getTime() > cutoff) continue;
    if (!best || w.date.getTime() > best.date.getTime()) best = w;
  }
  return best;
}

/**
 * Pages whose search traffic has fallen far enough to be worth a rewrite.
 *
 * Two independent tests, either of which is a finding:
 *
 *   **Clicks.** Down by more than `clicksDrop` per cent against the previous 28 days.
 *
 *   **Position.** Was inside `positionFloor` and is no longer. Worth its own test because
 *   it leads the click figure: a page that has just slipped from 9th to 12th has lost most
 *   of its future clicks and few of its past ones, so the clicks test will not catch it
 *   for another month.
 *
 * A page with too few impressions in both windows is not judged at all. Two clicks
 * becoming one is a 50% fall and means nothing, and a list where most rows are that is a
 * list nobody reads twice.
 */
export function detectDecay(
  pages: { url: string; windows: PageWindow[] }[],
  limits: DecayLimits,
): DecayFinding[] {
  const findings: DecayFinding[] = [];

  for (const { url, windows } of pages) {
    if (windows.length < 2) continue;

    const current = windows.reduce((a, b) => (b.date.getTime() > a.date.getTime() ? b : a));
    const prior = priorWindow(windows, current);
    // No window old enough to compare against. The page is not healthy, it is unjudged —
    // saying nothing is the honest answer until there is a second window.
    if (!prior) continue;

    // Judged on what it used to get. A page that has collapsed to nothing still deserves
    // the finding, so the floor is met if either window clears it.
    if (prior.impressions < limits.impressionFloor && current.impressions < limits.impressionFloor) {
      continue;
    }

    const clicksLost = prior.clicks - current.clicks;
    const dropPercent = prior.clicks > 0 ? (clicksLost / prior.clicks) * 100 : null;
    const lostClicks = dropPercent !== null && dropPercent > limits.clicksDrop;

    const slipped =
      prior.position !== null &&
      current.position !== null &&
      prior.position <= limits.positionFloor &&
      current.position > limits.positionFloor;

    if (!lostClicks && !slipped) continue;

    findings.push({
      url,
      reason: lostClicks && slipped ? 'both' : lostClicks ? 'clicks' : 'position',
      clicksBefore: prior.clicks,
      clicksNow: current.clicks,
      clicksLost: Math.max(0, clicksLost),
      dropPercent,
      positionBefore: prior.position,
      positionNow: current.position,
      from: prior.date,
      to: current.date,
    });
  }

  // Ordered by clicks actually lost, not by percentage. A page down 90% of its eight
  // clicks is a rounding error; one down 30% of four thousand is the morning's work. Ties
  // break on the steeper fall, then on URL so the order never depends on read order.
  return findings.sort(
    (a, b) =>
      b.clicksLost - a.clicksLost ||
      (b.dropPercent ?? 0) - (a.dropPercent ?? 0) ||
      a.url.localeCompare(b.url),
  );
}

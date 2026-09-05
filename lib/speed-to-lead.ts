import { db } from './prisma.ts';
import { CONTACT_TYPES, type Range } from './metrics.ts';
import { thresholds } from './settings.ts';

// Appendix C defines speed to lead as "distribution of first-touch times, including
// untouched". The application reported a median and excluded the untouched, which is the
// opposite emphasis: the untouched are the neglect, and they are the half the definition
// most wants.
//
// ── Why the untouched cannot go in the median ─────────────────────────────────────────
//
// They have no response time. Counting them as zero says they were answered instantly;
// counting them as the age of the lead says somebody answered at the moment we looked.
// Both are inventions, and the second is the more dangerous because it produces a
// plausible number that grows every day nobody acts.
//
// So they are a band of their own, sized against the whole, and the median is stated as
// what it is: the response time of the leads that got one.
//
// ── Why "too recent to judge" is separate from "never touched" ────────────────────────
//
// A lead that arrived an hour ago and has not been contacted is not neglect, it is
// Tuesday. Folding it in makes the untouched figure a measure of how recently the report
// was run — it would rise every morning as the night's leads arrived and fall as they were
// worked, and nobody could tell that from a real decline in service.
//
// The line is the first-contact SLA, the same threshold the SLA rule fires on, so the two
// cannot disagree about who is late.

/** The bands, in order. Upper bound in hours, exclusive; the last is open-ended. */
const BANDS: { key: string; label: string; upTo: number }[] = [
  { key: 'under1h', label: 'Under an hour', upTo: 1 },
  { key: 'under4h', label: '1 to 4 hours', upTo: 4 },
  { key: 'under24h', label: '4 to 24 hours', upTo: 24 },
  { key: 'under48h', label: '1 to 2 days', upTo: 48 },
  { key: 'under168h', label: '2 to 7 days', upTo: 168 },
  { key: 'over168h', label: 'Over a week', upTo: Infinity },
];

export type SpeedBand = {
  key: string;
  label: string;
  leads: number;
  /** Share of every lead in the period, including the untouched. */
  percent: number;
};

export type SpeedToLead = {
  /** Every lead created in the period, the denominator for every percentage here. */
  total: number;
  /** Leads that received an outbound touch, and how long each took. */
  touched: number;
  bands: SpeedBand[];
  /** Hours, over the touched only. Null when nothing was touched. */
  medianHours: number | null;
  /** Past the SLA with nothing logged. The figure Appendix C asks for and the app omitted. */
  untouched: number;
  untouchedPercent: number;
  /** Arrived too recently to have breached the SLA. Neither answered nor late. */
  tooRecent: number;
  slaHours: number;
};

const share = (n: number, of: number) => (of === 0 ? 0 : Number(((n / of) * 100).toFixed(1)));

/**
 * Sorts response times into bands. Pure, so the banding can be tested without a database.
 *
 * `hours` is the touched leads only; the untouched are passed as counts because they have
 * no value to band.
 */
export function distribute(
  hours: number[],
  untouched: number,
  tooRecent: number,
  slaHours: number,
): SpeedToLead {
  const total = hours.length + untouched + tooRecent;

  const counts = new Map<string, number>(BANDS.map((b) => [b.key, 0]));
  for (const h of hours) {
    // The first band whose upper bound this clears. Bounds are exclusive at the top, so a
    // response at exactly one hour is "1 to 4 hours" rather than "under an hour" — the
    // band that claims a lead must be one the lead genuinely finished inside.
    const band = BANDS.find((b) => h < b.upTo) ?? BANDS[BANDS.length - 1];
    counts.set(band.key, (counts.get(band.key) ?? 0) + 1);
  }

  const sorted = [...hours].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const medianHours = sorted.length
    ? sorted.length % 2
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2
    : null;

  return {
    total,
    touched: hours.length,
    bands: BANDS.map((b) => ({
      key: b.key,
      label: b.label,
      leads: counts.get(b.key) ?? 0,
      percent: share(counts.get(b.key) ?? 0, total),
    })),
    medianHours,
    untouched,
    untouchedPercent: share(untouched, total),
    tooRecent,
    slaHours,
  };
}

/**
 * The distribution over leads created in the period.
 *
 * Reads the same activity types `medianResponseHours` does, so the median printed here and
 * the one on the KPI card are the same measurement.
 */
export async function speedToLead(range: Range, now = new Date()): Promise<SpeedToLead> {
  const window = { gte: range.from, lte: range.to };
  const limits = await thresholds();
  const slaHours = limits['leads.slaHours'];

  const [leads, touches] = await Promise.all([
    // Every lead this time, not only the touched ones: the untouched are the point.
    db().lead.findMany({ where: { createdAt: window }, select: { id: true, createdAt: true } }),
    db().activity.findMany({
      where: { type: { in: [...CONTACT_TYPES] }, lead: { createdAt: window } },
      select: { leadId: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  const first = new Map<string, Date>();
  for (const t of touches) {
    if (t.leadId && !first.has(t.leadId)) first.set(t.leadId, t.createdAt);
  }

  const hours: number[] = [];
  let untouched = 0;
  let tooRecent = 0;

  for (const lead of leads) {
    const touched = first.get(lead.id);
    if (touched) {
      const h = (touched.getTime() - lead.createdAt.getTime()) / 3_600_000;
      // A touch logged before the lead row is a clock or import artefact, not a negative
      // response time. Counted as immediate rather than dropped: the lead was answered.
      hours.push(Math.max(0, h));
      continue;
    }
    const age = (now.getTime() - lead.createdAt.getTime()) / 3_600_000;
    if (age < slaHours) tooRecent += 1;
    else untouched += 1;
  }

  return distribute(hours, untouched, tooRecent, slaHours);
}

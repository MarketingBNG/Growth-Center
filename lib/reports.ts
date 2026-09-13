import { convertOrDrop, warnUnconverted } from './currency.ts';
import { currencySettings } from './settings.ts';
import { windowFor, type Range } from './metrics.ts';
import { moneyIn, type ReportContext, type Section } from './reports/shared.ts';
import { weeklyPack } from './reports/weekly-pack.ts';
import { executive } from './reports/executive.ts';
import { marketing } from './reports/marketing.ts';
import { leads } from './reports/leads.ts';
import { leadFlow } from './reports/lead-flow.ts';
import { sales } from './reports/sales.ts';
import { revenueByPartner } from './reports/revenue-by-partner.ts';
import { attribution } from './reports/attribution.ts';

export type { Section } from './reports/shared.ts';

// Reports are compositions of the SAME functions the pages use. Nothing here recomputes
// a metric its own way, which is what stops an exported report from disagreeing with the
// dashboard it was run from.
//
// Each report's own logic lives in lib/reports/<id>.ts — this file used to be one 735-line
// buildReport with eight `if (id === '...')` branches, which read as eight different
// reports pasted into one function. What stays here is the catalog, the shared types, and
// the dispatch between them.

export const REPORTS = [
  {
    // First in the list because it is the one with a standing time and a named reader.
    // The others are run when somebody wants them; this one has a Monday.
    id: 'weekly-pack',
    name: "The weekly pack",
    description: 'What needs a decision this week, and how last week was worked.',
  },
  {
    id: 'executive',
    name: 'Executive growth report',
    description: 'The funnel, revenue against spend, and where growth came from.',
  },
  {
    id: 'marketing',
    name: 'Marketing report',
    description: 'Campaign and channel performance with CAC and ROAS.',
  },
  {
    id: 'leads',
    name: 'Lead report',
    description: 'Volume, sources and qualification, plus who owns what.',
  },
  {
    id: 'lead-flow',
    name: 'Lead flow',
    description: 'Whether the daily lead flow is landing evenly across the team.',
  },
  {
    id: 'sales',
    name: 'Sales report',
    description: 'Pipeline by stage, deals won and lost, and revenue booked.',
  },
  {
    id: 'revenue-by-partner',
    name: 'Revenue by partner',
    description: 'Who closed the revenue, who referred it, and where it came from.',
  },
  {
    id: 'attribution',
    name: 'Revenue attribution',
    description: 'Revenue traced back to the channel and campaign that produced it.',
  },
] as const;

export type ReportId = (typeof REPORTS)[number]['id'];
export const isReportId = (v: string): v is ReportId => REPORTS.some((r) => r.id === v);

export type Report = { id: ReportId; name: string; range: Range; sections: Section[] };

/** One builder per report id, each taking the same context and returning its sections.
 *  Replaces what used to be an `if (id === '...')` chain — adding a report is adding an
 *  entry here and a file in lib/reports/, not another branch in a 700-line function. */
const BUILDERS: Record<ReportId, (ctx: ReportContext) => Promise<Section[]>> = {
  'weekly-pack': weeklyPack,
  executive,
  marketing,
  leads,
  'lead-flow': leadFlow,
  sales,
  'revenue-by-partner': revenueByPartner,
  attribution,
};

export async function buildReport(id: ReportId, spec: number | Range): Promise<Report> {
  const { current, previous } = windowFor(spec);
  const name = REPORTS.find((r) => r.id === id)!.name;

  // Deals and revenue here are written in more than one currency, so every figure below
  // converts before it adds. Summed flat, 143 rupee deals were counted as dollars.
  const fx = await currencySettings();
  const money = moneyIn(fx);
  // One set across every figure in the report: a currency with no rate is named once at
  // the end rather than per section, and an exported pack can never be short by an amount
  // nothing in the log mentions.
  const dropped = new Set<string>();
  const inFx = (amount: unknown, currency: string | null) =>
    convertOrDrop(Number(amount ?? 0), currency, fx, dropped);

  const sections = await BUILDERS[id]({ current, previous, fx, money, inFx });
  warnUnconverted(`report ${id}`, dropped, 'those amounts are missing from its figures');
  return { id, name, range: current, sections };
}

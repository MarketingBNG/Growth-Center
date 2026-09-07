import { db } from './prisma.ts';
import { csvDocument, csvParse, csvRow } from './csv.ts';
import { CONTENT_STATUSES, CONTENT_STATUS_LABELS } from './enums.ts';
import { COMPANY_SEGMENTS } from './company-facts.ts';
import {
  FORMATS,
  MAX_BRIEF,
  SERVICE_LINES,
  TOPIC_CLUSTERS,
  formatSlot,
  type ContentFormat,
} from './content-fields.ts';

// The content calendar, as a month rather than a pipeline.
//
// The board this page already had is §15.3's pipeline: nine statuses, idea to published,
// which answers "what is in flight and who is holding it". It cannot answer the question
// a content calendar exists to answer — what is going out on the 12th — and its own empty
// state admitted the gap: "Nothing imports content — this board is filled by hand."
//
// Both views read the same ContentPiece rows. There is no second table of calendar
// entries, because two tables would immediately disagree about what is scheduled.

// ── Months ────────────────────────────────────────────────────────────────────────────
//
// A month is held as the first instant of its first day in UTC, and spoken as `YYYY-MM`.
// UTC throughout, deliberately: `publishDate` is a plan for a day, not a moment, and
// deriving the month in local time puts the 1st of the month in the previous one for
// anybody east of Greenwich — which is everybody here.

export type MonthKey = string;

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

export const monthKey = (date: Date): MonthKey => date.toISOString().slice(0, 7);

/** The first instant of a `YYYY-MM`, or null if it is not one. */
export function parseMonth(value: string | null | undefined): Date | null {
  const match = MONTH_PATTERN.exec((value ?? '').trim());
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
}

/** The month containing today, for a page that was given no month to show. */
export const currentMonth = (now = new Date()): Date =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

export const addMonths = (month: Date, delta: number): Date =>
  new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + delta, 1));

/** Half-open: `from` is in the month, `to` is the first instant of the next one. */
export const monthRange = (month: Date) => ({ from: month, to: addMonths(month, 1) });

export const daysInMonth = (month: Date): number =>
  new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const monthLabel = (month: Date): string =>
  `${MONTH_NAMES[month.getUTCMonth()]} ${month.getUTCFullYear()}`;

// ── Reading a spreadsheet's headers ───────────────────────────────────────────────────

/**
 * The fields a calendar file can carry, and every header seen to mean each of them.
 *
 * Aliases rather than a fixed template, because the file is written by whoever plans the
 * month and it is not going to be renamed to suit this application. "Date", "Publish
 * Date", "Posting date" and "Go live" are all the same column, and a template that
 * refuses three of them is a template nobody uses twice.
 *
 * Matched on letters and digits only — see `headerKey` — so "Publish Date", "publish_date"
 * and "PUBLISH-DATE" are one alias, and the list stays readable.
 */
const HEADER_ALIASES: Record<string, readonly string[]> = {
  publishDate: ['date', 'publishdate', 'publishingdate', 'postdate', 'postingdate', 'golive', 'golivedate', 'day', 'scheduleddate', 'schedule'],
  publishMinute: ['time', 'slot', 'publishtime', 'posttime', 'postingtime', 'scheduledtime', 'golivetime', 'timeslot'],
  assetShape: ['assetshape', 'shape', 'assetformat', 'creativetype'],
  title: ['title', 'topic', 'content', 'contenttitle', 'headline', 'subject', 'idea', 'post', 'name', 'description'],
  format: ['format', 'type', 'contenttype', 'assettype', 'medium', 'kind'],
  status: ['status', 'stage', 'state', 'progress'],
  authorEmail: ['author', 'authoremail', 'owner', 'writer', 'assignedto', 'assignee', 'responsible'],
  designerEmail: ['designer', 'designeremail', 'design'],
  partnerVoice: ['partnervoice', 'voice', 'partner', 'spokesperson', 'byline'],
  channelSlug: ['channel', 'platform', 'network', 'placement'],
  brief: ['brief', 'notes', 'note', 'copy', 'caption', 'details', 'remarks', 'comments'],
  url: ['url', 'link', 'publishedurl', 'liveurl', 'permalink'],
  assetUrl: ['asset', 'asseturl', 'assetlink', 'creative', 'creativelink', 'designlink', 'drivelink', 'file'],
  targetKeyword: ['keyword', 'targetkeyword', 'primarykeyword', 'seokeyword'],
  topicCluster: ['topiccluster', 'cluster', 'pillar'],
  segment: ['segment', 'audience', 'persona'],
  serviceLine: ['serviceline', 'service', 'offering', 'practice'],
  tags: ['tags', 'tag', 'labels', 'hashtags'],
};

export type CalendarField = keyof typeof HEADER_ALIASES;

/**
 * Headers this app recognises and deliberately does not read.
 *
 * The performance columns. `views` and `leadsGenerated` are written by the metrics join,
 * and a calendar where they can be typed in is a calendar whose numbers mean nothing — so
 * the export writes them and the import must refuse them.
 *
 * Named here rather than left to fall through to `unmapped`, because "columns not read"
 * is a list of surprises: a calendar exported from here, edited and uploaded again would
 * otherwise report two of them every single time, and a warning that always fires is one
 * nobody reads.
 */
const IGNORED_HEADERS = new Set([
  'views', 'leads', 'leadsgenerated', 'reach', 'impressions', 'clicks', 'engagement',
  'engagementrate', 'opens', 'ctr',
]);

/** Letters and digits, lower-cased. Everything else in a header is decoration. */
const headerKey = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

const ALIAS_TO_FIELD = new Map<string, CalendarField>();
for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
  for (const alias of aliases) {
    // First alias listed wins, so `title`'s own "post" does not lose to `format`'s.
    if (!ALIAS_TO_FIELD.has(alias)) ALIAS_TO_FIELD.set(alias, field as CalendarField);
  }
}

/**
 * Which column holds which field.
 *
 * Returns the mapping and the headers it could not place. The unrecognised ones are
 * reported rather than dropped in silence: a calendar whose "Topic" column this app read
 * as nothing at all would import 30 untitled pieces and look like it had worked.
 */
export function mapHeaders(header: readonly string[]): {
  columns: Partial<Record<CalendarField, number>>;
  unmapped: string[];
} {
  const columns: Partial<Record<CalendarField, number>> = {};
  const unmapped: string[] = [];

  header.forEach((raw, index) => {
    const text = raw.trim();
    if (!text) return;
    const key = headerKey(text);
    if (IGNORED_HEADERS.has(key)) return;
    const field = ALIAS_TO_FIELD.get(key);
    // First column wins where a file has two that mean the same thing — a "Date" and a
    // "Date (IST)" — because the left-most is the one the planner filled in.
    if (field && columns[field] === undefined) columns[field] = index;
    else if (!field) unmapped.push(text);
  });

  return { columns, unmapped };
}

// ── Reading a date out of a cell ──────────────────────────────────────────────────────

const DAY_MONTH_YEAR = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/;
const ISO_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})/;
const DAY_AND_NAME = /^(\d{1,2})\s*(?:st|nd|rd|th)?[\s,-]+([a-z]{3,})/i;
const NAME_AND_DAY = /^([a-z]{3,})[\s,-]+(\d{1,2})/i;
const BARE_DAY = /^(\d{1,2})(?:\s*(?:st|nd|rd|th))?$/i;

const monthFromName = (name: string): number | null => {
  const wanted = name.slice(0, 3).toLowerCase();
  const index = MONTH_NAMES.findIndex((m) => m.slice(0, 3).toLowerCase() === wanted);
  return index === -1 ? null : index;
};

const utc = (year: number, month: number, day: number): Date | null => {
  const date = new Date(Date.UTC(year, month, day));
  // Rejects the 31st of a 30-day month rather than rolling it into the next one, which is
  // how a typo becomes a piece scheduled in a month nobody was looking at.
  if (date.getUTCMonth() !== ((month % 12) + 12) % 12 || date.getUTCDate() !== day) return null;
  return date;
};

/**
 * The day a row is planned for.
 *
 * `month` is the month the import is for, and it is what makes the loosest and most
 * common form readable at all: a calendar for one month often numbers its rows 1 to 30
 * and says the month once, in the file name or a heading. A bare "12" means the 12th of
 * the month being imported.
 *
 * `d/m/y` is read day-first. This firm is in India and its calendars are written in the
 * local convention; where the first number is over 12 the reading is not a choice, and
 * where both are under 12 the day-first reading is the one the planner meant. A month is
 * given as well as a file, so a misread date usually lands outside the month and is
 * refused with a reason — which is a much better failure than a piece silently moved to
 * the 3rd of December.
 */
export function parseCalendarDate(value: unknown, month: Date): Date | null {
  // exceljs hands back a real Date for a cell formatted as one, which is the common case
  // in an .xlsx and needs no parsing at all.
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return utc(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    // A small integer in a date column is a day of the month, not a spreadsheet serial:
    // day 30 of the epoch is January 1900 and nobody is planning content for it.
    if (Number.isInteger(value) && value >= 1 && value <= 31) {
      return utc(month.getUTCFullYear(), month.getUTCMonth(), value);
    }
    // Excel's serial: whole days since 1899-12-30, which is 1900-01-00 plus its own
    // famous leap-year bug already accounted for by that epoch.
    const serial = Math.floor(value);
    if (serial > 31 && serial < 100_000) {
      return new Date(Date.UTC(1899, 11, 30 + serial));
    }
    return null;
  }

  const text = String(value ?? '').trim();
  if (!text) return null;

  const iso = ISO_DATE.exec(text);
  if (iso) return utc(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

  const dmy = DAY_MONTH_YEAR.exec(text);
  if (dmy) {
    const [, first, second, rawYear] = dmy;
    const year = rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear);
    const day = Number(first);
    const monthIndex = Number(second) - 1;
    // Day-first, unless that cannot be a day and the other reading can.
    if (day > 31 || monthIndex > 11) {
      if (Number(second) <= 31 && Number(first) - 1 <= 11) {
        return utc(year, Number(first) - 1, Number(second));
      }
      return null;
    }
    return utc(year, monthIndex, day);
  }

  const dayName = DAY_AND_NAME.exec(text);
  if (dayName) {
    const named = monthFromName(dayName[2]);
    if (named !== null) {
      const year = /\b(\d{4})\b/.exec(text);
      return utc(year ? Number(year[1]) : month.getUTCFullYear(), named, Number(dayName[1]));
    }
  }

  const nameDay = NAME_AND_DAY.exec(text);
  if (nameDay) {
    const named = monthFromName(nameDay[1]);
    if (named !== null) {
      const year = /\b(\d{4})\b/.exec(text);
      return utc(year ? Number(year[1]) : month.getUTCFullYear(), named, Number(nameDay[2]));
    }
  }

  const bare = BARE_DAY.exec(text);
  if (bare) return utc(month.getUTCFullYear(), month.getUTCMonth(), Number(bare[1]));

  return null;
}

/**
 * A time of day as minutes from midnight, or null.
 *
 * Accepts what a calendar writes: "9:30 AM IST", "6:00 PM", "18:00", "9 AM", "10.30 am".
 * The timezone suffix is read and discarded — see CALENDAR_TIMEZONE for why there is one
 * clock and not a column of them.
 *
 * Refuses rather than guesses on anything out of range, so "25:00" and "9:75" become no
 * slot instead of a post scheduled at some hour that does not exist.
 */
export function parseSlot(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // A spreadsheet time cell is a fraction of a day: 0.395833… is 09:30. Whole numbers
    // are not times — a bare 9 in a slot column means nine o'clock, handled below as text.
    if (value > 0 && value < 1) return Math.round(value * 1440);
    return null;
  }

  const text = String(value ?? '').trim();
  if (!text) return null;

  const match = /^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?/i.exec(text);
  if (!match) return null;

  let hour = Number(match[1]);
  const minutes = match[2] === undefined ? 0 : Number(match[2]);
  const meridiem = match[3]?.toLowerCase();

  if (minutes > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === 'am') hour = hour === 12 ? 0 : hour;
    else hour = hour === 12 ? 12 : hour + 12;
  } else if (hour > 23) {
    return null;
  }

  return hour * 60 + minutes;
}

// ── Reading the rest of a row ─────────────────────────────────────────────────────────

/**
 * `format` is the six-value column on ContentPiece, and a calendar says "Reel", "Carousel"
 * or "YouTube Short" instead. These are the words the file uses mapped onto the words the
 * column holds; anything unrecognised falls back to the column default rather than
 * refusing the row, because the shape of an asset is not what a calendar is for.
 */
const FORMAT_ALIASES: Record<string, string> = {
  blog: 'blog', article: 'blog', blogpost: 'blog', longform: 'blog', writeup: 'blog',
  post: 'social', social: 'social', socialpost: 'social', carousel: 'social',
  story: 'social', graphic: 'social', creative: 'social', poll: 'social',
  video: 'video', reel: 'video', short: 'video', shorts: 'video', longvideo: 'video',
  avatarvideo: 'video', webinar: 'video', podcast: 'video', vlog: 'video',
  email: 'email', newsletter: 'email', mailer: 'email', edm: 'email',
  landingpage: 'landing_page', lp: 'landing_page', page: 'landing_page',
  casestudy: 'case_study', caselet: 'case_study', testimonial: 'case_study',
};

/**
 * Networks, kept apart from the aliases above and consulted only when nothing else
 * matched.
 *
 * A network is a channel, not a format, and a calendar routinely says both in one cell.
 * "Instagram Reel" is a video that happens to go to Instagram — reading it left to right
 * and stopping at the first word it recognises would file it as a social post. So the
 * word that names the asset wins, and the network is the fallback for a cell that names
 * only a place, like "LinkedIn".
 */
const NETWORK_FORMATS: Record<string, string> = {
  instagram: 'social', ig: 'social', linkedin: 'social', li: 'social', facebook: 'social',
  fb: 'social', twitter: 'social', x: 'social', threads: 'social', whatsapp: 'social',
  youtube: 'video', yt: 'video', shortsyoutube: 'video',
};

/**
 * The format column, read from whatever the file calls it.
 *
 * Three passes, because a real calendar's type column holds phrases rather than tokens:
 * the whole value ("Case Study", "Landing Page"), then each word for one that names an
 * asset ("YouTube Short" is a short), then each word for a network ("LinkedIn" alone is
 * a post). Anything still unrecognised falls back to the column default rather than
 * refusing the row — the shape of an asset is not what a calendar is for, and losing a
 * scheduled post over the word "infographic" would be absurd.
 */
export function readFormat(value: string): ContentFormat {
  const whole = headerKey(value);
  if (!whole) return 'blog';

  const known = (candidate: string | undefined): ContentFormat | null =>
    candidate && (FORMATS as readonly string[]).includes(candidate)
      ? (candidate as ContentFormat)
      : null;

  const exact = known(FORMAT_ALIASES[whole]) ?? known(NETWORK_FORMATS[whole]);
  if (exact) return exact;

  const words = value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  for (const word of words) {
    const asset = known(FORMAT_ALIASES[word]);
    if (asset) return asset;
  }
  for (const word of words) {
    const network = known(NETWORK_FORMATS[word]);
    if (network) return network;
  }

  return 'blog';
}

/** A status from the file, matched on the stored value or on the label the board shows. */
export function readStatus(value: string): (typeof CONTENT_STATUSES)[number] | null {
  const key = headerKey(value);
  if (!key) return null;
  const direct = CONTENT_STATUSES.find((s) => headerKey(s) === key);
  if (direct) return direct;
  const labelled = CONTENT_STATUSES.find((s) => headerKey(CONTENT_STATUS_LABELS[s]) === key);
  if (labelled) return labelled;
  // The words a spreadsheet uses for the two ends of the pipeline.
  if (['planned', 'todo', 'notstarted', 'new', 'backlog'].includes(key)) return 'idea';
  if (['done', 'live', 'posted', 'complete', 'completed'].includes(key)) return 'published';
  if (['writing', 'inprogress', 'wip'].includes(key)) return 'draft';
  if (['review', 'inreview', 'approval'].includes(key)) return 'partner_approval';
  return null;
}

const fromVocabulary = <T extends string>(list: readonly T[], value: string): T | null => {
  const key = headerKey(value);
  return key ? (list.find((item) => headerKey(item) === key) ?? null) : null;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;


const clamp = (value: string, max: number): string | null => {
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
};

/**
 * Tags from one cell.
 *
 * Split on whitespace as well as the usual separators, because a hashtag column is
 * written "#LaborDay #USIndia #CrossBorderBusiness" and splitting only on commas would
 * store that as a single 39-character tag.
 */
export function readTags(value: string): string[] {
  return value
    .split(/[;,|\s]+/)
    .map((t) => t.trim().replace(/^#/, '').slice(0, 40))
    .filter(Boolean)
    .slice(0, 20);
}

export type CalendarRow = {
  publishDate: Date;
  /** Minutes from midnight, wall-clock. See ContentPiece.publishMinute. */
  publishMinute: number | null;
  title: string;
  format: ContentFormat;
  /** The asset in the file's own words, where it said. See ContentPiece.assetShape. */
  assetShape: string | null;
  status: (typeof CONTENT_STATUSES)[number];
  authorEmail: string | null;
  designerEmail: string | null;
  partnerVoice: string | null;
  channelSlug: string | null;
  brief: string | null;
  url: string | null;
  assetUrl: string | null;
  targetKeyword: string | null;
  topicCluster: string | null;
  segment: string | null;
  serviceLine: string | null;
  tags: string[];
};

export type RowOutcome =
  | { ok: true; row: CalendarRow; unresolvedPerson: string | null }
  | { ok: false; reason: string };

/**
 * One spreadsheet row, read against the month it is being imported into.
 *
 * A row is refused for exactly two things: no title, and no readable date inside the
 * month. Everything else is optional and a bad value is dropped rather than fatal — an
 * unrecognised service line should not cost the firm a scheduled post.
 */
export function readRow(
  cells: readonly unknown[],
  columns: Partial<Record<CalendarField, number>>,
  month: Date,
  rowNumber: number,
): RowOutcome {
  const raw = (field: CalendarField): unknown => {
    const index = columns[field];
    return index === undefined ? undefined : cells[index];
  };
  const text = (field: CalendarField): string => {
    const value = raw(field);
    return value === undefined || value === null ? '' : String(value).trim();
  };

  const title = clamp(text('title'), 200);
  if (!title) return { ok: false, reason: `Row ${rowNumber}: no title.` };

  const dateCell = raw('publishDate');
  const parsed = parseCalendarDate(dateCell, month);
  if (!parsed) {
    const shown = String(dateCell ?? '').trim();
    return {
      ok: false,
      reason: shown
        ? `Row ${rowNumber} ("${title}"): could not read "${shown}" as a date.`
        : `Row ${rowNumber} ("${title}"): no date.`,
    };
  }

  const { from, to } = monthRange(month);
  if (parsed < from || parsed >= to) {
    return {
      ok: false,
      reason: `Row ${rowNumber} ("${title}"): ${parsed.toISOString().slice(0, 10)} is outside ${monthLabel(month)}.`,
    };
  }

  // An owner column usually holds a name. An email is stored; a name is reported back, so
  // the person uploading knows the calendar has owners this app could not attach to
  // anybody rather than finding out when nobody is assigned anything.
  const author = text('authorEmail');
  const authorEmail = EMAIL.test(author) ? author.toLowerCase() : null;
  const designer = text('designerEmail');

  const tags = readTags(text('tags'));

  return {
    ok: true,
    unresolvedPerson: author && !authorEmail ? author : null,
    row: {
      publishDate: parsed,
      publishMinute: parseSlot(raw('publishMinute')),
      title,
      format: readFormat(text('format')),
      // The type column's own words, kept beside the six-value `format` derived from
      // them: "Instagram Reel" and "CAROUSEL - 5 slides" both reduce to one of six, and
      // the reduction is what the board needs rather than what a producer does.
      assetShape: clamp(text('assetShape'), 60) ?? clamp(text('format'), 60),
      // A calendar with dates is a plan, and a plan is an idea until somebody works on
      // it. Only a status the file states is taken; §15.3's ordering means a piece cannot
      // be dropped straight into `published` by a spreadsheet either way.
      status: readStatus(text('status')) ?? 'idea',
      authorEmail,
      designerEmail: EMAIL.test(designer) ? designer.toLowerCase() : null,
      partnerVoice: clamp(text('partnerVoice'), 120),
      channelSlug: clamp(text('channelSlug'), 60),
      brief: clamp(text('brief'), MAX_BRIEF),
      url: clamp(text('url'), 500),
      assetUrl: clamp(text('assetUrl'), 500),
      targetKeyword: clamp(text('targetKeyword'), 200),
      topicCluster: fromVocabulary(TOPIC_CLUSTERS, text('topicCluster')),
      segment: fromVocabulary(COMPANY_SEGMENTS, text('segment')),
      serviceLine: fromVocabulary(SERVICE_LINES, text('serviceLine')),
      tags,
    },
  };
}

// ── The other shape a calendar comes in ───────────────────────────────────────────────
//
// Everything above reads a table: one row per piece, columns named at the top. That is
// what a calendar looks like when it was built to be read by something.
//
// A calendar built to be *worked from* looks nothing like it. USAIndiaCFO's September
// master sheet is two columns and 237 rows for 27 posts: a header line per post carrying
// the date, the slot, the profile, the asset shape, the pillar and the topic, and beneath
// it a block of labelled fields holding the whole deliverable — the hook, the five-slide
// script, the caption, the CTA, the hashtags. There is no header row anywhere and no
// column means one thing all the way down.
//
//   1. 07/09/2026 · Monday · 9:30 AM IST · INSTAGRAM + LINKEDIN · STATIC · OCCASION · US Labor Day
//   HOOK / ON-CREATIVE LINE | TO EVERYONE WHO BUILT SOMETHING TODAY, IN EITHER TIME ZONE.
//   FULL CREATIVE TEXT      | SINGLE STATIC …
//   CAPTION                 | It's Labor Day in the US …
//   HASHTAGS                | #LaborDay #USIndia #CrossBorderBusiness
//   STATUS                  | Draft | Same creative on Instagram and LinkedIn
//
// The table reader refuses this file outright — no header row, so no rows. Handling it is
// not a favour to one spreadsheet: this is the house format, it is what the studio will
// send every month, and asking a content team to flatten their working document into a
// grid before the application will read it is how an import feature goes unused.

/** `1. 07/09/2026 · Monday · …` — a numbered post header, which is what starts a block. */
const BLOCK_HEADER = /^(\d{1,3})\s*[.)]\s*(.+)$/;
const TIME_SEGMENT = /^\d{1,2}[:.]\d{2}\s*(?:am|pm)?\b/i;
const WEEKDAY = /^(mon|tues|wednes|thurs|fri|satur|sun)day$/i;
const NETWORK = /instagram|linkedin|facebook|youtube|threads|twitter|\bx\b|whatsapp/i;
const ASSET_SHAPE = /static|carousel|reel|short|video|text|image|webinar|newsletter|story|graphic/i;

/** A row that opens a post block, and the header text after its number. */
function blockHeader(cell: string): string | null {
  const match = BLOCK_HEADER.exec(cell.trim());
  if (!match) return null;
  const rest = match[2];
  // A numbered line is only a header if it carries the separators and a date. Otherwise it
  // is prose that happens to start with "1." — a numbered slide inside a block, say.
  if (!rest.includes('·')) return null;
  return rest;
}

/**
 * The metadata line at the top of a block.
 *
 * Read by anchoring on the time rather than by counting from the left, because the pillar
 * segment is present on some posts and absent on others — sixteen of September's 27 carry
 * one — and a positional read would file the topic as the format for the eleven that do
 * not. The slot is the one segment whose shape is unmistakable, and the format puts the
 * profile immediately after it and the asset shape after that. The topic is always last.
 *
 * With no recognisable time the fields are classified by what they look like instead,
 * which is weaker but still finds the date and the topic — the two a row cannot do
 * without.
 */
export function readBlockHeader(header: string, month: Date) {
  const segments = header.split('·').map((s) => s.trim()).filter(Boolean);
  if (!segments.length) return null;

  const publishDate = parseCalendarDate(segments[0], month);
  const title = segments.length > 1 ? segments[segments.length - 1] : null;

  const middle = segments.slice(1, -1).filter((s) => !WEEKDAY.test(s));
  const timeAt = middle.findIndex((s) => TIME_SEGMENT.test(s));

  let slot: string | null = null;
  let profile: string | null = null;
  let shape: string | null = null;
  let pillars: string[] = [];

  if (timeAt !== -1) {
    slot = middle[timeAt];
    profile = middle[timeAt + 1] ?? null;
    shape = middle[timeAt + 2] ?? null;
    pillars = middle.slice(timeAt + 3);
  } else {
    profile = middle.find((s) => NETWORK.test(s)) ?? null;
    shape = middle.find((s) => ASSET_SHAPE.test(s) && s !== profile) ?? null;
    pillars = middle.filter((s) => s !== profile && s !== shape);
  }

  return { publishDate, title, slot, profile, shape, pillars };
}

/**
 * The asset shape, read from the block's own words.
 *
 * `readFormat` is built for a type column and is not enough here: this sheet's shapes are
 * "STATIC", "TEXT", "TEXT + IMAGE (1 creative)" and "CAROUSEL - 5 slides", and only the
 * last of those means anything to a generic alias table. What settles the other three is
 * the profile beside them — a static or a text post on an Instagram or LinkedIn profile is
 * a social post, and so is one going out on a partner's own account.
 */
function readBlockFormat(shape: string | null, profile: string | null): ContentFormat {
  const words = `${shape ?? ''}`;
  if (/carousel|story|graphic|static|image/i.test(words)) return 'social';
  if (/reel|short|video|webinar/i.test(words)) return 'video';
  if (/newsletter|mailer|email/i.test(words)) return 'email';
  // "TEXT" on its own. A text post is a social post when it goes out on a profile, and
  // only a blog when nothing says otherwise.
  if (/text/i.test(words)) return profile ? 'social' : 'blog';
  return readFormat(words || profile || '');
}

/**
 * `Draft | Owner: someone@x.com | Asset link: https://…` — several fields in one cell.
 *
 * `notes` is the rest, and it exists because reading only the first three threw content
 * away: two of September's posts say "Draft | Same creative on Instagram and LinkedIn",
 * and that second clause is a production instruction, not a status. It went nowhere. Any
 * pipe-separated part that is not the status, the owner or the asset link is kept and
 * ends up in the brief with the rest of the post's own words.
 */
function readStatusCell(value: string) {
  const parts = value.split('|').map((p) => p.trim()).filter(Boolean);
  const status = readStatus(parts[0] ?? '');

  let owner: string | null = null;
  let asset: string | null = null;
  const notes: string[] = [];

  // A `for…of` rather than `forEach`: assigning a closed-over `let` inside a callback
  // does not narrow it, and both of these typed as `never` at every later use.
  for (const part of parts.slice(1)) {
    const [, ownerValue] = /^owner\s*:\s*(.*)$/i.exec(part) ?? [];
    if (ownerValue !== undefined) {
      owner = ownerValue.trim() || null;
      continue;
    }
    const [, assetValue] = /^asset\s*link\s*:\s*(.*)$/i.exec(part) ?? [];
    if (assetValue !== undefined) {
      asset = assetValue.trim() || null;
      continue;
    }
    notes.push(part);
  }

  // A first part that is not a recognisable status is not a status — it is the note of a
  // cell that leads with something else, and dropping it would be the same fault.
  if (!status && parts[0]) notes.unshift(parts[0]);

  return { status, owner, asset, notes };
}

/** Labels whose value is the piece's own tags rather than prose. */
const TAG_LABELS = /^(hashtags?|tags?)$/i;
/** Labels naming the pillar, which is the firm's own vocabulary and not `topicCluster`'s. */
const PILLAR_LABELS = /^(pillar|vertical|category)$/i;
const STATUS_LABELS = /^status\b/i;

/**
 * One post block: its header line, and the labelled rows beneath it.
 *
 * The labelled rows are kept whole, in the order the sheet has them, as the brief. That is
 * the deliverable — nobody writes a five-slide script twice — and folding it into one
 * editable field is what makes the imported piece worth opening. Losing it to a tidier
 * schema would make the import a list of titles.
 */
export function readBlock(
  header: string,
  rows: readonly (readonly string[])[],
  month: Date,
  rowNumber: number,
): RowOutcome {
  const parsed = readBlockHeader(header, month);
  if (!parsed) return { ok: false, reason: `Row ${rowNumber}: could not read "${header}".` };

  const title = parsed.title ? parsed.title.slice(0, 200) : null;
  if (!title) return { ok: false, reason: `Row ${rowNumber}: no topic at the end of "${header}".` };

  if (!parsed.publishDate) {
    return { ok: false, reason: `Row ${rowNumber} ("${title}"): could not read a date in "${header}".` };
  }
  const { from, to } = monthRange(month);
  if (parsed.publishDate < from || parsed.publishDate >= to) {
    return {
      ok: false,
      reason: `Row ${rowNumber} ("${title}"): ${parsed.publishDate.toISOString().slice(0, 10)} is outside ${monthLabel(month)}.`,
    };
  }

  const tags = [...parsed.pillars];
  let status: (typeof CONTENT_STATUSES)[number] | null = null;
  let owner: string | null = null;
  let assetUrl: string | null = null;
  const brief: string[] = [];

  // The header's three facts now have columns of their own — publishMinute, assetShape,
  // and channelSlug or partnerVoice — so they are not copied into the brief as well. They
  // were, for one commit, because the schema had nowhere else to put them; a field and a
  // line of prose saying the same thing is how the two come to disagree after an edit.

  for (const row of rows) {
    const label = (row[0] ?? '').trim();
    const value = (row[1] ?? '').trim();
    if (!label && !value) continue;

    if (TAG_LABELS.test(label)) {
      tags.push(...readTags(value));
      continue;
    }
    if (PILLAR_LABELS.test(label)) {
      if (value) tags.push(value);
      continue;
    }
    if (STATUS_LABELS.test(label)) {
      const read = readStatusCell(value);
      status = read.status;
      owner = read.owner;
      assetUrl = read.asset;
      for (const note of read.notes) brief.push(`NOTE: ${note}`);
      continue;
    }
    // Everything else is content, and is kept with the label the sheet gave it: "CAPTION"
    // and "FULL SLIDE CONTENT" are different things to whoever has to produce them.
    brief.push(label ? `${label}:\n${value}` : value);
  }

  // Deduped and capped, but NOT re-split. A pillar arrives as one label — "Brand & IP
  // (IPR vertical)", "Structure & Incorporation", "CASE STUDY" — and running the hashtag
  // splitter over it a second time turned five pillars into nineteen tags of "&", "(IPR",
  // "vertical)" and "STUDY". Hashtag cells are split on their way in, above, and nothing
  // needs splitting twice.
  const cleanTags = [
    ...new Set(tags.map((t) => t.trim().replace(/^#/, '').slice(0, 40)).filter(Boolean)),
  ].slice(0, 20);

  return {
    ok: true,
    unresolvedPerson: owner && !EMAIL.test(owner) ? owner : null,
    row: {
      publishDate: parsed.publishDate,
      publishMinute: parseSlot(parsed.slot),
      title,
      format: readBlockFormat(parsed.shape, parsed.profile),
      assetShape: parsed.shape ? parsed.shape.slice(0, 60) : null,
      status: status ?? 'idea',
      authorEmail: owner && EMAIL.test(owner) ? owner.toLowerCase() : null,
      designerEmail: null,
      // The profile a post goes out on is either a place or a person. A network is the
      // channel; a named account — "AKSHAY SIR", "IPR FOUNDER" — is whose voice it is,
      // which is §15.2's partnerVoice and the reason that column exists.
      partnerVoice: parsed.profile && !NETWORK.test(parsed.profile) ? parsed.profile.slice(0, 120) : null,
      channelSlug: parsed.profile && NETWORK.test(parsed.profile) ? parsed.profile.slice(0, 60) : null,
      brief: brief.length ? brief.join('\n\n').slice(0, MAX_BRIEF) : null,
      url: null,
      assetUrl: assetUrl ? assetUrl.slice(0, 500) : null,
      targetKeyword: null,
      topicCluster: null,
      segment: null,
      serviceLine: null,
      tags: cleanTags,
    },
  };
}

/**
 * A whole master sheet: every numbered block in it.
 *
 * The blank row between blocks is not the delimiter — the next header is. A sheet with no
 * blank rows, or two of them, reads the same.
 */
export function readMasterSheet(grid: readonly (readonly unknown[])[], month: Date): SheetRead {
  const cells = grid.map((row) => row.map((c) => (c === null || c === undefined ? '' : String(c))));

  const starts: { at: number; header: string }[] = [];
  cells.forEach((row, i) => {
    const header = blockHeader(row[0] ?? '');
    if (header) starts.push({ at: i, header });
  });

  const rows: CalendarRow[] = [];
  const skippedReasons: string[] = [];
  const unresolvedPeople = new Set<string>();

  starts.forEach((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1].at : cells.length;
    const outcome = readBlock(start.header, cells.slice(start.at + 1, end), month, start.at + 1);
    if (outcome.ok) {
      rows.push(outcome.row);
      if (outcome.unresolvedPerson) unresolvedPeople.add(outcome.unresolvedPerson);
    } else {
      skippedReasons.push(outcome.reason);
    }
  });

  return {
    rows,
    rowsRead: starts.length,
    skippedReasons,
    // There are no columns to be unmapped: every label in a block is read, as content if
    // it is nothing more specific.
    unmappedHeaders: [],
    unresolvedPeople: [...unresolvedPeople],
  };
}

/** Two or more numbered post blocks means the sheet is a master sheet, not a table. */
export function looksLikeMasterSheet(grid: readonly (readonly unknown[])[]): boolean {
  let found = 0;
  for (const row of grid) {
    const first = row[0];
    if (blockHeader(first === null || first === undefined ? '' : String(first))) found++;
    if (found >= 2) return true;
  }
  return false;
}

export type SheetRead = {
  rows: CalendarRow[];
  skippedReasons: string[];
  rowsRead: number;
  unmappedHeaders: string[];
  unresolvedPeople: string[];
};

/**
 * A whole sheet: find the header row, then read everything under it.
 *
 * The header is hunted for rather than assumed to be row 1, because a calendar exported
 * from Sheets very often starts with a merged title cell — "Content Calendar — September"
 * — and one or two blank rows. The first row that names at least a title column and a
 * date column is the header; anything above it is decoration.
 *
 * A sheet with no header row at all may still be a calendar: see `readMasterSheet` for the
 * block layout this firm's studio actually works in. Detected rather than chosen, because
 * whoever is uploading a file should not have to know which of two readers it needs.
 */
export function readSheet(grid: readonly (readonly unknown[])[], month: Date): SheetRead {
  if (looksLikeMasterSheet(grid)) return readMasterSheet(grid, month);

  let headerAt = -1;
  let columns: Partial<Record<CalendarField, number>> = {};
  let unmapped: string[] = [];

  const limit = Math.min(grid.length, 20);
  for (let i = 0; i < limit; i++) {
    const candidate = mapHeaders(grid[i].map((c) => (c === null || c === undefined ? '' : String(c))));
    if (candidate.columns.title !== undefined && candidate.columns.publishDate !== undefined) {
      headerAt = i;
      columns = candidate.columns;
      unmapped = candidate.unmapped;
      break;
    }
  }

  if (headerAt === -1) {
    return {
      rows: [],
      rowsRead: 0,
      unmappedHeaders: [],
      unresolvedPeople: [],
      skippedReasons: [
        'No header row found, and no numbered post blocks either. A calendar needs either a row naming at least a title column and a date column — "Title" and "Date" will do — or one numbered header line per post, like "1. 07/09/2026 · 9:30 AM IST · INSTAGRAM · STATIC · Topic".',
      ],
    };
  }

  const rows: CalendarRow[] = [];
  const skippedReasons: string[] = [];
  const unresolvedPeople = new Set<string>();
  let rowsRead = 0;

  for (let i = headerAt + 1; i < grid.length; i++) {
    const cells = grid[i];
    // A row of empty cells is the gap between two weeks, not a failed import.
    if (cells.every((c) => c === null || c === undefined || String(c).trim() === '')) continue;
    rowsRead++;

    // Spreadsheet row numbers, one-based, so a reason can be acted on in the file itself.
    const outcome = readRow(cells, columns, month, i + 1);
    if (outcome.ok) {
      rows.push(outcome.row);
      if (outcome.unresolvedPerson) unresolvedPeople.add(outcome.unresolvedPerson);
    } else {
      skippedReasons.push(outcome.reason);
    }
  }

  return {
    rows,
    rowsRead,
    skippedReasons,
    unmappedHeaders: unmapped,
    unresolvedPeople: [...unresolvedPeople],
  };
}

/** A CSV, as a grid, ready for `readSheet`. */
export const csvGrid = (text: string): string[][] => csvParse(text);

// ── The month on screen ───────────────────────────────────────────────────────────────

/**
 * A piece as the calendar shows it — and as its editor writes it back.
 *
 * Every field the edit form can change is here, including the ones the grid tile never
 * displays. That is not padding: the form sends the whole record on save, so a field the
 * page did not load would arrive back as empty and clear a target keyword or a topic
 * cluster that nobody touched. A month is tens of rows, so the columns are free; a
 * request per tile to fill in a form that may never open would not be.
 */
export type CalendarPiece = {
  id: string;
  title: string;
  format: string;
  assetShape: string | null;
  /** Minutes from midnight, wall-clock, or null where the piece has no slot. */
  publishMinute: number | null;
  status: (typeof CONTENT_STATUSES)[number];
  publishDate: Date;
  authorEmail: string | null;
  designerEmail: string | null;
  partnerVoice: string | null;
  channelSlug: string | null;
  brief: string | null;
  url: string | null;
  assetUrl: string | null;
  targetKeyword: string | null;
  topicCluster: string | null;
  segment: string | null;
  serviceLine: string | null;
  tags: string[];
  imported: boolean;
  approved: boolean;
};

export type CalendarDay = {
  /** Null for the leading and trailing blanks that pad the grid to whole weeks. */
  date: Date | null;
  pieces: CalendarPiece[];
};

export type CalendarImport = {
  id: string;
  importedByEmail: string;
  fileName: string;
  fileFormat: string;
  rowsRead: number;
  created: number;
  skipped: number;
  skippedReasons: string[];
  createdAt: Date;
  /** Pieces from this import still present. A replaced calendar keeps published work. */
  remaining: number;
};

/**
 * One month, as weeks of days.
 *
 * Weeks start on Monday. The working week here runs Monday to Saturday and a grid that
 * starts on Sunday puts the first working day of the week in the middle of a row.
 *
 * Padding days carry a null date rather than being omitted, so the grid is always whole
 * weeks and the template does not have to compute an offset.
 */
export async function contentCalendar(month: Date) {
  const { from, to } = monthRange(month);

  const [pieces, imports] = await Promise.all([
    db().contentPiece.findMany({
      where: { publishDate: { gte: from, lt: to } },
      // Within a day, by slot: three posts on the 7th are a running order, not a set.
      // Nulls last, because a piece with no time is not scheduled before one with 9:30.
      orderBy: [
        { publishDate: 'asc' },
        { publishMinute: { sort: 'asc', nulls: 'last' } },
        { createdAt: 'asc' },
      ],
      select: {
        id: true, title: true, format: true, status: true, publishDate: true,
        publishMinute: true, assetShape: true,
        authorEmail: true, designerEmail: true, partnerVoice: true, channelSlug: true,
        brief: true, url: true, assetUrl: true, targetKeyword: true, topicCluster: true,
        segment: true, serviceLine: true, tags: true,
        importId: true, approvedAt: true,
      },
    }),
    // Newest first: the calendar on screen is the one the latest import left behind, and
    // an older import for the same month has been replaced.
    db().contentImport.findMany({
      where: { month },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { pieces: true } } },
    }),
  ]);

  const mapped: CalendarPiece[] = pieces.map((p) => ({
    id: p.id,
    title: p.title,
    format: p.format,
    assetShape: p.assetShape,
    publishMinute: p.publishMinute,
    status: p.status,
    // Non-null by the query: the month is a range filter on this column.
    publishDate: p.publishDate as Date,
    authorEmail: p.authorEmail,
    designerEmail: p.designerEmail,
    partnerVoice: p.partnerVoice,
    channelSlug: p.channelSlug,
    brief: p.brief,
    url: p.url,
    assetUrl: p.assetUrl,
    targetKeyword: p.targetKeyword,
    topicCluster: p.topicCluster,
    segment: p.segment,
    serviceLine: p.serviceLine,
    tags: p.tags,
    imported: p.importId !== null,
    approved: p.approvedAt !== null,
  }));

  const byDay = new Map<number, CalendarPiece[]>();
  for (const piece of mapped) {
    const day = piece.publishDate.getUTCDate();
    const list = byDay.get(day);
    if (list) list.push(piece);
    else byDay.set(day, [piece]);
  }

  // getUTCDay() is 0 for Sunday; Monday-first wants Sunday last.
  const firstWeekday = (month.getUTCDay() + 6) % 7;
  const total = daysInMonth(month);

  const days: CalendarDay[] = [];
  for (let i = 0; i < firstWeekday; i++) days.push({ date: null, pieces: [] });
  for (let day = 1; day <= total; day++) {
    days.push({
      date: new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), day)),
      pieces: byDay.get(day) ?? [],
    });
  }
  while (days.length % 7 !== 0) days.push({ date: null, pieces: [] });

  const weeks: CalendarDay[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  const latest = imports[0] ?? null;

  return {
    month,
    monthKey: monthKey(month),
    label: monthLabel(month),
    weeks,
    pieces: mapped,
    counts: {
      total: mapped.length,
      imported: mapped.filter((p) => p.imported).length,
      byHand: mapped.filter((p) => !p.imported).length,
      published: mapped.filter((p) => p.status === 'published').length,
    },
    lastImport: latest
      ? ({
          id: latest.id,
          importedByEmail: latest.importedByEmail,
          fileName: latest.fileName,
          fileFormat: latest.fileFormat,
          rowsRead: latest.rowsRead,
          created: latest.created,
          skipped: latest.skipped,
          skippedReasons: latest.skippedReasons,
          createdAt: latest.createdAt,
          remaining: latest._count.pieces,
        } satisfies CalendarImport)
      : null,
    /** Every import this month has had, so a replacement does not erase the record of one. */
    importCount: imports.length,
  };
}

// ── Importing ─────────────────────────────────────────────────────────────────────────

export type ImportSummary = {
  importId: string;
  month: MonthKey;
  rowsRead: number;
  created: number;
  skipped: number;
  skippedReasons: string[];
  unmappedHeaders: string[];
  unresolvedPeople: string[];
  /** Pieces removed by a replace, and the ones it refused to remove. */
  replaced: number;
  keptPublished: number;
};

/**
 * Writes a read sheet into the month.
 *
 * `replace` is what the Replace button sends. It removes the pieces earlier imports left
 * in this month and nothing else: a piece somebody added by hand is not part of the
 * calendar that arrived in a file, and deleting it because a spreadsheet was uploaded
 * again would be the application throwing away work it was never given.
 *
 * Published pieces survive a replace even though they were imported. By the time a piece
 * is published it has a URL, an approval and — through the metrics join — views and leads
 * against it. That is no longer a plan, and re-uploading September's spreadsheet is not a
 * reason to lose it. The count is returned so the caller can say so out loud.
 *
 * One transaction: a replace that deleted the old calendar and then failed to write the
 * new one would leave the month empty, which is worse than either outcome.
 */
export async function importCalendar(input: {
  month: Date;
  sheet: SheetRead;
  fileName: string;
  fileFormat: 'csv' | 'xlsx';
  actorEmail: string;
  replace: boolean;
}): Promise<ImportSummary> {
  const { month, sheet, fileName, fileFormat, actorEmail, replace } = input;
  const { from, to } = monthRange(month);

  const result = await db().$transaction(async (tx) => {
    let replaced = 0;
    let keptPublished = 0;

    if (replace) {
      const previous = await tx.contentPiece.findMany({
        where: { publishDate: { gte: from, lt: to }, importId: { not: null } },
        select: { id: true, status: true },
      });
      const removable = previous.filter((p) => p.status !== 'published' && p.status !== 'repurposed');
      keptPublished = previous.length - removable.length;

      if (removable.length) {
        const { count } = await tx.contentPiece.deleteMany({
          where: { id: { in: removable.map((p) => p.id) } },
        });
        replaced = count;
      }

      // The old provenance rows go with their pieces; the ones that kept a published
      // piece stay, because that piece still came from somewhere and the row is the only
      // thing that says where.
      await tx.contentImport.deleteMany({ where: { month, pieces: { none: {} } } });
    }

    const record = await tx.contentImport.create({
      data: {
        month,
        importedByEmail: actorEmail,
        fileName: fileName.slice(0, 260),
        fileFormat,
        rowsRead: sheet.rowsRead,
        created: sheet.rows.length,
        skipped: sheet.skippedReasons.length,
        // Capped: a file with 500 broken rows should not put 500 lines in a row nobody
        // can read. The count above is the whole truth; these are the examples.
        skippedReasons: sheet.skippedReasons.slice(0, 50),
      },
      select: { id: true },
    });

    if (sheet.rows.length) {
      await tx.contentPiece.createMany({
        data: sheet.rows.map((row) => ({
          ...row,
          importId: record.id,
          // §15.4's provenance column. An imported piece is neither a person's idea nor a
          // sync's discovery, and the board reads differently if you cannot tell.
          createdBy: 'calendar_import',
        })),
      });
    }

    return { importId: record.id, replaced, keptPublished };
  },
  // Prisma's defaults are a 2-second wait for the connection and a 5-second transaction,
  // and neither fits a hosted Postgres: acquiring a connection from a serverless compute
  // that has been idle takes longer than two seconds, which is how this first failed —
  // P2028, "unable to start a transaction in the given time", before a single row was
  // read. The same numbers lib/ai.ts arrived at for the same reason.
  { timeout: 30_000, maxWait: 10_000 });

  await db().auditEvent.create({
    data: {
      actorEmail,
      action: replace ? 'content.calendar_replace' : 'content.calendar_import',
      entityType: 'content_import',
      entityId: result.importId,
      detail: {
        month: monthKey(month),
        fileName,
        fileFormat,
        rowsRead: sheet.rowsRead,
        created: sheet.rows.length,
        skipped: sheet.skippedReasons.length,
        replaced: result.replaced,
        keptPublished: result.keptPublished,
      },
    },
  });

  return {
    importId: result.importId,
    month: monthKey(month),
    rowsRead: sheet.rowsRead,
    created: sheet.rows.length,
    skipped: sheet.skippedReasons.length,
    skippedReasons: sheet.skippedReasons.slice(0, 50),
    unmappedHeaders: sheet.unmappedHeaders,
    unresolvedPeople: sheet.unresolvedPeople,
    replaced: result.replaced,
    keptPublished: result.keptPublished,
  };
}

// ── Exporting ─────────────────────────────────────────────────────────────────────────

/**
 * The columns an export writes, in order.
 *
 * The same names the import reads, so a calendar exported from here, edited in Sheets and
 * uploaded again round-trips without anybody renaming a column. That is the property
 * worth having: the export is how you get a template.
 */
export const EXPORT_HEADERS = [
  'Date', 'Time', 'Title', 'Format', 'Asset shape', 'Status', 'Author', 'Designer',
  'Partner voice', 'Channel', 'Topic cluster', 'Segment', 'Service line', 'Target keyword',
  'Brief', 'URL', 'Asset', 'Tags', 'Views', 'Leads',
] as const;

export async function calendarRowsForExport(month: Date) {
  const { from, to } = monthRange(month);
  const pieces = await db().contentPiece.findMany({
    where: { publishDate: { gte: from, lt: to } },
    orderBy: [
      { publishDate: 'asc' },
      { publishMinute: { sort: 'asc', nulls: 'last' } },
      { title: 'asc' },
    ],
    select: {
      publishDate: true, publishMinute: true, title: true, format: true, assetShape: true,
      status: true, authorEmail: true,
      designerEmail: true, partnerVoice: true, channelSlug: true, topicCluster: true,
      segment: true, serviceLine: true, targetKeyword: true, brief: true, url: true,
      assetUrl: true, tags: true, views: true, leadsGenerated: true,
    },
  });

  return pieces.map((p) => [
    p.publishDate ? p.publishDate.toISOString().slice(0, 10) : '',
    // "9:30 AM" rather than 570: the export is read by people, and `parseSlot` reads it
    // straight back on the way in.
    formatSlot(p.publishMinute) ?? '',
    p.title,
    p.format,
    p.assetShape ?? '',
    p.status,
    p.authorEmail ?? '',
    p.designerEmail ?? '',
    p.partnerVoice ?? '',
    p.channelSlug ?? '',
    p.topicCluster ?? '',
    p.segment ?? '',
    p.serviceLine ?? '',
    p.targetKeyword ?? '',
    p.brief ?? '',
    p.url ?? '',
    p.assetUrl ?? '',
    p.tags.join('; '),
    String(p.views),
    String(p.leadsGenerated),
  ]);
}

/** ISO dates and a header row, through the escaping in lib/csv.ts. */
export async function calendarCsv(month: Date): Promise<string> {
  const rows = await calendarRowsForExport(month);
  return csvDocument([csvRow([...EXPORT_HEADERS]), ...rows.map((r) => csvRow(r))]);
}

import { route } from '@/lib/platform/api';
import { HttpError } from '@/lib/access/auth';
import {
  AI_IMPORT_SOURCE,
  AI_IMPRESSIONS_KEY,
  AiImportError,
  parseAiExport,
} from '@/lib/analytics/gsc-ai-import';
import { writePoints } from '@/lib/integrations/persist';
import { parseMonth, monthKey } from '@/lib/content-calendar';
import { recordAudit } from '@/lib/platform/audit';
import { TAGS, invalidate } from '@/lib/platform/cache';
import type { MetricPoint } from '@/lib/integrations/types';

// Search Console's AI performance report, uploaded by hand.
//
// Google reports AI Overview and AI Mode impressions in the Search Console interface and
// publishes no API for them, so there is nothing to sync — the report is exported monthly
// and uploaded here. This route exists because the alternative is not having the numbers.
//
// Gated on integrations:manage rather than growth:read: this writes vendor data into the
// metrics table, which is the same authority as connecting a provider, not the authority
// to look at a chart.

/** A month of pages for one site. Tens of kilobytes in practice. */
const MAX_BYTES = 5 * 1024 * 1024;

export const POST = route('integrations:manage', async (user, req) => {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new HttpError(400, 'Send the file as multipart form data.');
  }

  const file = form.get('file');
  if (!(file instanceof File)) throw new HttpError(400, 'No file was uploaded.');
  if (file.size === 0) throw new HttpError(422, 'That file is empty.');
  if (file.size > MAX_BYTES) {
    throw new HttpError(413, `That file is ${(file.size / 1_048_576).toFixed(1)}MB. The limit is 5MB.`);
  }

  // Asked for, never inferred. The export carries no date inside it, and guessing "the
  // month it was uploaded" would file September's report as October's for anyone who
  // uploads late — which is everyone, because the report is only complete once the month
  // has ended.
  const month = parseMonth(String(form.get('month') ?? ''));
  if (!month) throw new HttpError(422, 'Give the month the report covers as YYYY-MM, e.g. 2026-08.');

  const name = file.name || 'ai-report';
  const extension = name.toLowerCase().split('.').pop() ?? '';
  if (extension !== 'csv' && extension !== 'txt') {
    throw new HttpError(
      422,
      `Cannot read a .${extension || 'file'}. Export the report as CSV and upload that.`,
    );
  }

  let parsed: ReturnType<typeof parseAiExport>;
  try {
    parsed = parseAiExport(await file.text());
  } catch (e) {
    // The parser's messages are written to be read by the person holding the file, so
    // they are passed through rather than replaced with a generic 422.
    if (e instanceof AiImportError) throw new HttpError(422, e.message);
    throw e;
  }

  // Dated to the first of the month it covers. The unique key on metric_snapshot is
  // (source, entityType, entityId, metricKey, date), so re-uploading a corrected export
  // for the same month overwrites that month rather than adding a second copy of it.
  const points: MetricPoint[] = parsed.rows.map((row) => ({
    entityType: 'seo_page',
    entityId: row.url,
    metricKey: AI_IMPRESSIONS_KEY,
    date: month,
    value: row.impressions,
  }));

  // A distinct `source`, which is what keeps these rows out of everything else. The SEO
  // readers match on entityType and metricKey, and no synced provider writes
  // `ai_impressions` — but the source column is what makes "which of these came from a
  // spreadsheet" answerable at all, and it is the pack's own requirement.
  const written = await writePoints(AI_IMPORT_SOURCE, points);

  await recordAudit({
    actorEmail: user.email,
    action: 'seo.ai_report_import',
    entityType: 'seo_page',
    detail: {
      month: monthKey(month),
      fileName: name,
      pages: parsed.rows.length,
      skipped: parsed.skipped.length,
      matchedColumns: parsed.matched,
    },
  });

  await invalidate(TAGS.seo);

  return {
    month: monthKey(month),
    pages: parsed.rows.length,
    written,
    // Returned rather than swallowed: a file where forty rows imported and nine were
    // dropped is a file worth looking at again, and the reasons are the only way to know
    // which nine.
    skipped: parsed.skipped,
    matchedColumns: parsed.matched,
  };
});

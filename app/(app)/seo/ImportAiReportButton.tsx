'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/patterns/field';
import { Modal } from '@/components/ui/modal';
import { ErrorText } from '@/components/patterns/state';
import { useBooleanApiAction } from '@/lib/shared/use-api-action';

type Summary = {
  month: string;
  pages: number;
  written: number;
  skipped: { line: number; reason: string }[];
  matchedColumns: { url: string; impressions: string };
};

/**
 * Uploads the monthly Search Console AI performance export.
 *
 * Modelled on ImportCalendarButton, including the decision that matters most here: the
 * dialog stays open on success and reports what happened. An import is the one action that
 * can quietly do less than it appears to, and with this file there is a specific way that
 * happens — the wrong tab of the right report, or a column Google renamed — so the summary
 * names which columns were actually read rather than only counting rows.
 *
 * Sends multipart rather than going through `api()`, for the reason that component gives.
 */
export function ImportAiReportButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const { busy, error, run, setError } = useBooleanApiAction();

  function close() {
    setOpen(false);
    setError(null);
    setSummary(null);
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSummary(null);

    const form = new FormData(e.currentTarget);
    await run(async () => {
      const res = await fetch('/api/seo/ai-report', { method: 'POST', body: form });
      const text = await res.text();
      const parsed = (text ? JSON.parse(text) : {}) as Record<string, unknown>;
      if (!res.ok) throw new Error((parsed.error as string) || `Upload failed (${res.status})`);
      setSummary(parsed as unknown as Summary);
      router.refresh();
    });
  }

  // Defaults to last month: the report is only complete once the month has ended, so the
  // month somebody is uploading is almost never the one they are in.
  const lastMonth = new Date();
  lastMonth.setUTCDate(1);
  lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);

  return (
    <>
      <Button size="action" variant="outline" onClick={() => setOpen(true)}>
        <Upload /> AI report
      </Button>

      <Modal
        open={open}
        onClose={close}
        title="Import the AI performance report"
        description="Search Console publishes no API for AI Overview and AI Mode impressions, so this report is exported by hand. Export the Pages tab as CSV."
      >
        <form onSubmit={submit} className="space-y-3">
          <Field
            label="Month the report covers"
            required
            hint="Re-uploading a corrected export for the same month replaces it rather than doubling it."
          >
            <Input
              type="month"
              name="month"
              required
              defaultValue={lastMonth.toISOString().slice(0, 7)}
            />
          </Field>

          <Field label="File" required hint="The Pages tab, as .csv. The Queries tab is refused.">
            <Input
              type="file"
              name="file"
              required
              accept=".csv,.txt,text/csv"
              className="h-auto py-1.5 text-xs file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-2 file:py-1 file:text-xs file:font-medium"
            />
          </Field>

          <ErrorText error={error} />

          {summary ? (
            <div className="space-y-2 rounded-lg border border-success/30 bg-success/5 p-2.5 text-meta">
              <p className="text-xs font-semibold text-foreground">
                {summary.pages} {summary.pages === 1 ? 'page' : 'pages'} imported for {summary.month}.
              </p>

              {/* Which columns were read, not just how many rows. Google renames these,
                  and a file where "Impressions" was matched when "AI impressions" was
                  meant imports cleanly and stores the wrong number. */}
              <p className="text-muted-foreground">
                Read from <span className="font-medium text-foreground">{summary.matchedColumns.url}</span>{' '}
                and <span className="font-medium text-foreground">{summary.matchedColumns.impressions}</span>.
              </p>

              {summary.skipped.length ? (
                <div>
                  <p className="font-medium text-warning-strong">
                    {summary.skipped.length} {summary.skipped.length === 1 ? 'row' : 'rows'} refused:
                  </p>
                  <ul className="mt-1 space-y-0.5 text-muted-foreground">
                    {/* Five and a count. Fifty broken rows are one problem repeated. */}
                    {summary.skipped.slice(0, 5).map((s) => (
                      <li key={s.line}>
                        Line {s.line}: {s.reason}
                      </li>
                    ))}
                    {summary.skipped.length > 5 ? (
                      <li>…and {summary.skipped.length - 5} more.</li>
                    ) : null}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={close}>
              {summary ? 'Done' : 'Cancel'}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Reading…' : summary ? 'Import another' : 'Import'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/patterns/field';
import { Modal } from '@/components/ui/modal';

type Summary = {
  rowsRead: number;
  created: number;
  skipped: number;
  skippedReasons: string[];
  unmappedHeaders: string[];
  unresolvedPeople: string[];
  replaced: number;
  keptPublished: number;
};

/**
 * Uploads a month's calendar.
 *
 * Not through `lib/fetcher`'s `api()`: that serialises a JSON body, and this sends a file
 * as multipart. The error shape is read the same way, so a refusal from the route reads
 * the same here as everywhere else.
 *
 * The summary is shown rather than closed over. An import is the one action on this page
 * that can quietly do less than it appears to — a mis-picked month, a column this app did
 * not recognise, thirty rows with no date — and the numbers are the only place that shows
 * up. So the dialog stays open on success and reports what happened, and closing it is a
 * separate decision.
 *
 * `replace` is what makes a second upload safe to attempt. Without it a corrected
 * spreadsheet uploaded again doubles the month.
 */
export function ImportCalendarButton({ month, replaceable }: { month: string; replaceable: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);

  function close() {
    setOpen(false);
    setError(null);
    setSummary(null);
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSummary(null);

    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch('/api/content/calendar/import', { method: 'POST', body: form });
      const text = await res.text();
      const parsed = (text ? JSON.parse(text) : {}) as Record<string, unknown>;
      if (!res.ok) throw new Error((parsed.error as string) || `Upload failed (${res.status})`);
      setSummary(parsed as unknown as Summary);
      // The calendar behind the dialog is now wrong. Refreshed while the dialog is still
      // open, so closing it reveals the month that was just imported.
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="action" variant="outline" onClick={() => setOpen(true)}>
        <Upload /> Import
      </Button>

      <Modal
        open={open}
        onClose={close}
        title={replaceable ? 'Replace this calendar' : 'Import a content calendar'}
        description="A .csv or .xlsx with a row per piece. It needs a title column and a date column; everything else is optional."
      >
        <form onSubmit={submit} className="space-y-3">
          <Field label="Month" required hint="Rows dated outside this month are refused rather than moved.">
            <Input type="month" name="month" required defaultValue={month} />
          </Field>

          <Field label="File" required>
            <Input
              type="file"
              name="file"
              required
              accept=".csv,.xlsx,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="h-auto py-1.5 text-xs file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-2 file:py-1 file:text-xs file:font-medium"
            />
          </Field>

          {replaceable ? (
            <label className="flex items-start gap-2 rounded-lg border border-border bg-secondary/40 p-2.5">
              <input type="checkbox" name="replace" value="true" defaultChecked className="mt-0.5" />
              <span className="text-[11px] leading-relaxed text-muted-foreground">
                <span className="font-medium text-foreground">Replace the imported calendar for this month.</span>{' '}
                Removes the pieces earlier imports left here. Anything added by hand stays, and so does
                anything already published — that has a URL, an approval and performance against it.
              </span>
            </label>
          ) : null}

          {error ? <p className="text-xs text-destructive">{error}</p> : null}

          {summary ? (
            <div className="space-y-2 rounded-lg border border-success/30 bg-success/5 p-2.5 text-[11px]">
              <p className="text-xs font-semibold text-foreground">
                {summary.created} {summary.created === 1 ? 'piece' : 'pieces'} imported
                {summary.rowsRead !== summary.created ? ` from ${summary.rowsRead} rows` : ''}.
              </p>

              {summary.replaced || summary.keptPublished ? (
                <p className="text-muted-foreground">
                  {summary.replaced} replaced
                  {summary.keptPublished
                    ? `, ${summary.keptPublished} kept because ${summary.keptPublished === 1 ? 'it is' : 'they are'} already published`
                    : ''}
                  .
                </p>
              ) : null}

              {summary.unresolvedPeople.length ? (
                <p className="text-muted-foreground">
                  No email for {summary.unresolvedPeople.join(', ')}, so {summary.unresolvedPeople.length === 1 ? 'that piece has' : 'those pieces have'}{' '}
                  no author. Set one in the file or edit the piece here.
                </p>
              ) : null}

              {summary.unmappedHeaders.length ? (
                <p className="text-muted-foreground">
                  Columns not read: {summary.unmappedHeaders.join(', ')}.
                </p>
              ) : null}

              {summary.skipped ? (
                <div>
                  <p className="font-medium text-warning-strong">{summary.skipped} rows refused:</p>
                  <ul className="mt-1 space-y-0.5 text-muted-foreground">
                    {/* Five, and a count for the rest. A file with fifty broken rows has
                        one problem repeated, and the first few show what it is. */}
                    {summary.skippedReasons.slice(0, 5).map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                    {summary.skippedReasons.length > 5 ? (
                      <li>…and {summary.skippedReasons.length - 5} more.</li>
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
              {busy ? 'Reading…' : summary ? 'Import another' : replaceable ? 'Replace' : 'Import'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

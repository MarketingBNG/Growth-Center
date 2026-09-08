'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Field } from '@/components/patterns/field';
import { Modal } from '@/components/ui/modal';
import { api } from '@/lib/fetcher';
import { CONTENT_STATUSES, CONTENT_STATUS_LABELS } from '@/lib/enums';
import {
  CALENDAR_TIMEZONE,
  FORMAT_LABELS,
  FORMATS,
  MAX_BRIEF,
  SERVICE_LINES,
  TOPIC_CLUSTERS,
  slotToInput,
} from '@/lib/content-fields';
import { COMPANY_SEGMENTS } from '@/lib/company-facts';

export type EditablePiece = {
  id: string;
  title: string;
  format: string;
  status: string;
  /** `YYYY-MM-DD`, for the date input. Null where the piece is not on the calendar. */
  publishDate: string | null;
  /** Minutes from midnight, wall-clock. Null where the piece has no slot. */
  publishMinute: number | null;
  assetShape: string | null;
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

const label = (value: string) => value.replaceAll('_', ' ');

/**
 * The board could create a piece and drag it between statuses, and that was every change
 * it could make. Anything else — a date moved, a title corrected, an owner assigned —
 * meant editing the spreadsheet and importing it again, which is how the copy on screen
 * stops being the one anybody trusts.
 *
 * The whole record is sent on save, which is why the API's patch schema distinguishes an
 * omitted field from one set to null: an empty input here means "clear it", not "leave it
 * as it was".
 *
 * Status is in this form but goes to the same guarded path the board's dropdown uses, so
 * §15.3's ordering and §21.2's publish gate apply here too — including the case this
 * form makes newly reachable, where somebody edits the title of an approved piece and
 * publishes it in one submission. The fields are written first and the gate then sees the
 * edit, refuses, and says why.
 */
export function EditPieceModal({
  piece,
  open,
  onClose,
}: {
  piece: EditablePiece | null;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!piece) return null;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!piece) return;
    setBusy(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    // An empty input is a cleared field, so this returns null rather than undefined —
    // undefined would be dropped by JSON.stringify and the field would silently keep its
    // old value while the form showed it as empty.
    const value = (key: string): string | null => {
      const raw = (form.get(key) as string | null)?.trim();
      return raw ? raw : null;
    };

    try {
      await api(`/api/content/${piece.id}`, {
        method: 'PATCH',
        json: {
          title: value('title') ?? piece.title,
          status: form.get('status'),
          format: form.get('format'),
          publishDate: value('publishDate'),
          // "09:30" from the time input, converted to minutes on the server so there is
          // one place that knows the column's shape.
          publishTime: value('publishTime'),
          assetShape: value('assetShape'),
          authorEmail: value('authorEmail'),
          designerEmail: value('designerEmail'),
          partnerVoice: value('partnerVoice'),
          channelSlug: value('channelSlug'),
          brief: value('brief'),
          url: value('url'),
          assetUrl: value('assetUrl'),
          targetKeyword: value('targetKeyword'),
          topicCluster: value('topicCluster'),
          segment: value('segment'),
          serviceLine: value('serviceLine'),
          tags: (value('tags') ?? '')
            .split(/[;,]/)
            .map((t) => t.trim().replace(/^#/, ''))
            .filter(Boolean)
            .slice(0, 20),
        },
      });
      onClose();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Edit piece" description={piece.title}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Title" required>
          <Input name="title" required maxLength={200} defaultValue={piece.title} />
        </Field>

        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Date">
            <Input type="date" name="publishDate" defaultValue={piece.publishDate ?? ''} />
          </Field>
          <Field label={`Slot (${CALENDAR_TIMEZONE})`}>
            <Input type="time" name="publishTime" defaultValue={slotToInput(piece.publishMinute)} />
          </Field>
          <Field label="Status">
            <Select name="status" defaultValue={piece.status}>
              {CONTENT_STATUSES.map((s) => (
                <option key={s} value={s}>{CONTENT_STATUS_LABELS[s]}</option>
              ))}
            </Select>
          </Field>
          <Field label="Format">
            <Select name="format" defaultValue={piece.format}>
              {FORMATS.map((f) => <option key={f} value={f}>{FORMAT_LABELS[f]}</option>)}
            </Select>
          </Field>
        </div>

        <Field
          label="Asset"
          hint="The shape in your own words — &ldquo;Carousel, 5 slides&rdquo;. Format above is the six-value one the board groups by."
        >
          <Input name="assetShape" maxLength={60} defaultValue={piece.assetShape ?? ''} />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Author" hint="An email address — it is who the board holds responsible.">
            <Input type="email" name="authorEmail" defaultValue={piece.authorEmail ?? ''} />
          </Field>
          <Field label="Designer">
            <Input type="email" name="designerEmail" defaultValue={piece.designerEmail ?? ''} />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Partner voice" hint="Whose voice it goes out in, where that is not the author.">
            <Input name="partnerVoice" maxLength={120} defaultValue={piece.partnerVoice ?? ''} />
          </Field>
          <Field label="Channel">
            <Input name="channelSlug" maxLength={60} defaultValue={piece.channelSlug ?? ''} />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Topic cluster">
            <Select name="topicCluster" defaultValue={piece.topicCluster ?? ''}>
              <option value="">—</option>
              {TOPIC_CLUSTERS.map((t) => <option key={t} value={t}>{label(t)}</option>)}
            </Select>
          </Field>
          <Field label="Segment">
            <Select name="segment" defaultValue={piece.segment ?? ''}>
              <option value="">—</option>
              {COMPANY_SEGMENTS.map((s) => <option key={s} value={s}>{label(s)}</option>)}
            </Select>
          </Field>
          <Field label="Service line">
            <Select name="serviceLine" defaultValue={piece.serviceLine ?? ''}>
              <option value="">—</option>
              {SERVICE_LINES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
            </Select>
          </Field>
        </div>

        <Field label="Target keyword">
          <Input name="targetKeyword" maxLength={200} defaultValue={piece.targetKeyword ?? ''} />
        </Field>

        {/* Taller than the other fields and scrollable: an imported piece's brief is the
            whole deliverable — hook, slide script, caption, CTA — not a one-line note. */}
        <Field label="Brief">
          <Textarea
            name="brief"
            rows={10}
            maxLength={MAX_BRIEF}
            defaultValue={piece.brief ?? ''}
            className="font-mono text-meta leading-relaxed"
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Asset" hint="Where the draft or design lives.">
            <Input name="assetUrl" maxLength={500} defaultValue={piece.assetUrl ?? ''} />
          </Field>
          <Field label="Published URL">
            <Input name="url" maxLength={500} defaultValue={piece.url ?? ''} />
          </Field>
        </div>

        <Field label="Tags" hint="Separated by commas.">
          <Input name="tags" defaultValue={piece.tags.join(', ')} />
        </Field>

        {error ? <p className="text-xs text-destructive">{error}</p> : null}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </Modal>
  );
}

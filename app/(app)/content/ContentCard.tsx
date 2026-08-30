'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Select } from '@/components/ui/input';
import { api } from '@/lib/fetcher';
import { CONTENT_STATUSES } from '@/lib/enums';
import { safeUrl } from '@/lib/format';

export type Piece = {
  id: string;
  title: string;
  format: string;
  status: string;
  authorEmail: string | null;
  publishDate: string | null;
  views: number;
  leadsGenerated: number;
  campaignName: string | null;
  url: string | null;
};

export function ContentCard({ piece }: { piece: Piece }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function move(status: string) {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/content/${piece.id}`, { method: 'PATCH', json: { status } });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-2.5">
      <p className="text-sm font-medium leading-snug">{piece.title}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        {piece.format.replaceAll('_', ' ')}
        {piece.authorEmail ? ` · ${piece.authorEmail.split('@')[0]}` : ''}
      </p>
      {piece.campaignName ? (
        <p className="text-[11px] text-muted-foreground">{piece.campaignName}</p>
      ) : null}
      {piece.publishDate ? (
        <p className="text-[11px] text-muted-foreground">{piece.publishDate}</p>
      ) : null}

      {piece.views > 0 || piece.leadsGenerated > 0 ? (
        <p className="mt-1.5 text-[11px] tnum">
          <span className="text-muted-foreground">views</span> {piece.views.toLocaleString('en-US')}
          {' · '}
          <span className="text-muted-foreground">leads</span> {piece.leadsGenerated}
        </p>
      ) : null}

      <div className="mt-2 flex items-center gap-1.5">
        <Select
          aria-label="Status"
          className="h-7 flex-1 text-[11px]"
          value={piece.status}
          disabled={busy}
          onChange={(e) => move(e.target.value)}
        >
          {CONTENT_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>
        {safeUrl(piece.url) ? (
          <a
            href={safeUrl(piece.url)!}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground hover:text-foreground"
            aria-label="Open published piece"
          >
            <ExternalLink className="size-3.5" />
          </a>
        ) : null}
      </div>
      {error ? <p className="mt-1 text-[11px] text-destructive">{error}</p> : null}
    </div>
  );
}

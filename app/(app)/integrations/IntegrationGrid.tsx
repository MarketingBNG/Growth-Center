'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ExternalLink, Plug, RefreshCw, Unplug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { StateBadge } from '@/components/patterns/integration-state';
import { api } from '@/lib/fetcher';
import { fmtRelative } from '@/lib/format';
import type { Card as IntegrationCard } from '@/lib/integrations/service';

const CATEGORY_LABEL: Record<string, string> = {
  analytics: 'Analytics',
  ads: 'Advertising',
  social: 'Social',
  crm: 'CRM',
  seo: 'SEO',
  email: 'Email',
};

export function IntegrationGrid({
  cards,
  canManage,
}: {
  cards: IntegrationCard[];
  canManage: boolean;
}) {
  const grouped = cards.reduce<Record<string, IntegrationCard[]>>((acc, c) => {
    (acc[c.category] ??= []).push(c);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {Object.entries(grouped).map(([category, list]) => (
        <section key={category}>
          <h2 className="pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {CATEGORY_LABEL[category] ?? category}
          </h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {list.map((c) => (
              <ProviderCard key={c.id} card={c} canManage={canManage} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ProviderCard({ card, canManage }: { card: IntegrationCard; canManage: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | 'connect' | 'sync' | 'disconnect'>(null);
  const [error, setError] = useState<string | null>(null);
  const [keyModal, setKeyModal] = useState(false);

  const connected = card.state === 'connected' || card.state === 'syncing';

  async function connectOauth() {
    setBusy('connect');
    setError(null);
    try {
      const { url } = await api<{ url: string }>(`/api/integrations/${card.id}/connect`, {
        method: 'POST',
        json: {},
      });
      window.location.href = url;
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  async function connectApiKey(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy('connect');
    setError(null);
    const form = new FormData(e.currentTarget);
    try {
      await api(`/api/integrations/${card.id}/connect`, {
        method: 'POST',
        json: {
          apiKey: String(form.get('apiKey') ?? '').trim(),
          config: { domain: String(form.get('domain') ?? '').trim() },
        },
      });
      setKeyModal(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function run(action: 'sync' | 'disconnect') {
    setBusy(action);
    setError(null);
    try {
      await api(`/api/integrations/${card.id}/${action}`, { method: 'POST', json: {} });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight">{card.name}</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{card.summary}</p>
        </div>
        <StateBadge state={card.state} />
      </div>

      <div className="flex flex-wrap gap-1 pt-3">
        {card.provides.map((p) => (
          <span
            key={p}
            className="rounded border border-border bg-secondary/50 px-1.5 py-0.5 text-[10px] text-muted-foreground"
          >
            {p}
          </span>
        ))}
      </div>

      <dl className="space-y-0.5 pt-3 text-[11px]">
        <Meta label="Auth" value={card.authKind === 'oauth2' ? 'OAuth' : 'API key'} />
        <Meta
          label="Last sync"
          value={
            card.state === 'demo_data'
              ? 'Seeded, not synced'
              : card.lastSyncAt
                ? `${fmtRelative(card.lastSyncAt)}${card.lastSyncRows !== null ? ` · ${card.lastSyncRows} rows` : ''}`
                : 'Never'
          }
        />
        {card.connectedByEmail ? (
          <Meta label="Connected by" value={card.connectedByEmail.split('@')[0]} />
        ) : null}
      </dl>

      {card.state === 'demo_data' ? (
        <p className="mt-3 rounded-md border border-warning/30 bg-warning/10 px-2 py-1.5 text-[11px] text-warning">
          Showing seeded demo figures. This is not a live connection.
        </p>
      ) : null}

      {card.lastError ? (
        <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
          {card.lastError}
          {card.lastErrorAt ? (
            <span className="block opacity-70">{fmtRelative(card.lastErrorAt)}</span>
          ) : null}
        </p>
      ) : null}

      {card.missingEnv.length > 0 ? (
        <div className="mt-3 rounded-md border border-border bg-secondary/40 px-2 py-1.5">
          <p className="text-[11px] font-medium">Requires API credentials</p>
          <ul className="mt-0.5 space-y-0.5">
            {card.missingEnv.map((e) => (
              <li key={e.name} className="text-[11px] text-muted-foreground">
                <span className="font-mono">{e.name}</span> — {e.description}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? <p className="mt-3 text-[11px] text-destructive">{error}</p> : null}

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
        {!canManage ? (
          <p className="text-[11px] text-muted-foreground">
            Your role cannot change integrations.
          </p>
        ) : connected ? (
          <>
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run('sync')}>
              <RefreshCw className={busy === 'sync' ? 'animate-spin' : undefined} />
              {busy === 'sync' ? 'Syncing…' : 'Sync now'}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => run('disconnect')}>
              <Unplug /> Disconnect
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              disabled={busy !== null || !card.configured}
              onClick={() => (card.authKind === 'oauth2' ? connectOauth() : setKeyModal(true))}
              title={card.configured ? undefined : 'Missing environment variables'}
            >
              <Plug /> {busy === 'connect' ? 'Connecting…' : 'Connect'}
            </Button>
            {card.state === 'demo_data' ? (
              <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => run('disconnect')}>
                Clear demo state
              </Button>
            ) : null}
          </>
        )}

        {card.docsUrl ? (
          <a
            href={card.docsUrl}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            Docs <ExternalLink className="size-3" />
          </a>
        ) : null}
      </div>

      <Modal
        open={keyModal}
        onClose={() => setKeyModal(false)}
        title={`Connect ${card.name}`}
        description="The key is encrypted before it is stored and is never sent to the browser again."
      >
        <form onSubmit={connectApiKey} className="space-y-3">
          <div className="space-y-1">
            <Label>API key</Label>
            <Input name="apiKey" required autoFocus autoComplete="off" />
          </div>
          <div className="space-y-1">
            <Label>Domain</Label>
            <Input name="domain" required placeholder="usaindiacfo.com" />
          </div>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setKeyModal(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy !== null}>
              {busy === 'connect' ? 'Validating…' : 'Connect'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate">{value}</dd>
    </div>
  );
}

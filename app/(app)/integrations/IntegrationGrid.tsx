'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ExternalLink, Plug, RefreshCw, Settings2, Unplug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/patterns/field';
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
  // One grid across every provider rather than a section per category. Grouped, most
  // categories held a single provider, so each got a row to itself and the cards ran
  // down the left third of the page. The category still travels with the card as a
  // label, so nothing is lost by dropping the headings.
  const ordered = [...cards].sort(
    (a, b) =>
      a.category.localeCompare(b.category) || a.name.localeCompare(b.name),
  );

  return (
    <div className="grid items-start gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
      {ordered.map((c) => (
        <ProviderCard key={c.id} card={c} canManage={canManage} />
      ))}
    </div>
  );
}

function ProviderCard({ card, canManage }: { card: IntegrationCard; canManage: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | 'connect' | 'sync' | 'disconnect' | 'settings'>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [keyModal, setKeyModal] = useState(false);
  const [settingsModal, setSettingsModal] = useState(false);

  // A stored credential is what "connected" means, not the last sync's verdict. One
  // failed sync sets the row to `error`, and treating that as disconnected swapped the
  // card's Sync/Disconnect buttons for Connect — which for an API-key provider is a
  // prompt to type the key again, even though the working key was still in the database.
  // `cards()` already downgrades a credential-less `connected` row to `error`, so an
  // error carrying a credential is a sync failure, not a lost connection.
  //
  // 'sync_stalled' is on the same footing for exactly that reason: it is a connected row
  // whose last run died holding the lock. Offering Connect there would ask someone to
  // re-authorise a connection that is fine; what they need is Sync now, which will take
  // the abandoned lease.
  const connected =
    card.state === 'connected' ||
    card.state === 'syncing' ||
    card.state === 'sync_stalled' ||
    (card.state === 'error' && card.hasCredential);

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
          config: Object.fromEntries(
            card.configFields.map((f) => [f.name, String(form.get(f.name) ?? '').trim()]),
          ),
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

  async function saveSettings(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy('settings');
    setError(null);
    const form = new FormData(e.currentTarget);
    try {
      await api(`/api/integrations/${card.id}/config`, {
        method: 'PATCH',
        json: {
          config: Object.fromEntries(
            card.configFields.map((f) => [f.name, String(form.get(f.name) ?? '').trim()]),
          ),
        },
      });
      setSettingsModal(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  /**
   * Drives a sync to completion.
   *
   * A provider with tens of thousands of records cannot be pulled inside one request, so
   * the server does a bounded slice and answers `done: false` with its place saved. This
   * calls back until it says done, which is what lets a 39,000-record backfill finish
   * without any single request being long enough to time out.
   *
   * Bounded so a provider that never reports done cannot spin the browser forever.
   */
  async function syncToCompletion() {
    for (let pass = 0; pass < 200; pass++) {
      const res = await api<{ rows: number; detail: string; done: boolean }>(
        `/api/integrations/${card.id}/sync`,
        { method: 'POST', json: {} },
      );
      setProgress(res.detail);
      if (res.done) return;
      // Each pass writes what it fetched, so the tables fill as this runs.
      router.refresh();
    }
    setError('The sync is taking an unusual number of passes. It will continue overnight.');
  }

  async function run(action: 'sync' | 'disconnect') {
    setBusy(action);
    setError(null);
    setProgress(null);
    try {
      if (action === 'sync') await syncToCompletion();
      else await api(`/api/integrations/${card.id}/${action}`, { method: 'POST', json: {} });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex h-full flex-col rounded-2xl border border-border bg-card p-[18px] shadow-card">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="pb-0.5 text-[10.5px] font-bold uppercase tracking-[0.07em] text-muted-foreground">
            {CATEGORY_LABEL[card.category] ?? card.category}
          </p>
          <h3 className="text-[14.5px] font-bold tracking-tight">{card.name}</h3>
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

      {card.hasCredential && card.credentialExpiresAt
        ? (() => {
            const days = Math.ceil(
              (new Date(card.credentialExpiresAt).getTime() - Date.now()) / 86_400_000,
            );
            if (days > 14) return null;
            return (
              <p className="mt-3 rounded-md border border-warning/30 bg-warning/10 px-2 py-1.5 text-[11px] text-warning">
                {days <= 0
                  ? 'The stored authorisation has expired. Reconnect.'
                  : `Authorisation expires in ${days} ${days === 1 ? 'day' : 'days'}. A sync renews it automatically.`}
              </p>
            );
          })()
        : null}

      {card.hasCredential && card.missingConfig.length > 0 ? (
        <p className="mt-3 rounded-md border border-warning/30 bg-warning/10 px-2 py-1.5 text-[11px] text-warning">
          Connected, but syncing needs {card.missingConfig.join(' and ')}. Open Settings.
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
      {progress && !error ? (
        <p className="mt-3 text-[11px] text-muted-foreground">{progress}</p>
      ) : null}

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
            {card.configFields.length > 0 ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() => setSettingsModal(true)}
              >
                <Settings2 /> Settings
              </Button>
            ) : null}
            {card.authKind !== 'oauth2' ? (
              // The way back when the key itself is the problem — reachable without
              // disconnecting first, which would throw away the sync watermark.
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => setKeyModal(true)}>
                <Plug /> Replace key
              </Button>
            ) : null}
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
          <Field label="API key" required>
            <Input name="apiKey" required autoFocus autoComplete="off" />
          </Field>
          {card.configFields.map((f) => (
            <Field key={f.name} label={f.label} required={f.required} hint={f.help}>
              <Input name={f.name} required={f.required} placeholder={f.placeholder} />
            </Field>
          ))}
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

      <Modal
        open={settingsModal}
        onClose={() => setSettingsModal(false)}
        title={`${card.name} settings`}
        description="Not secrets — these say which account to pull from. Stored in plain text alongside the connection."
      >
        <form onSubmit={saveSettings} className="space-y-3">
          {card.configFields.map((f) => (
            <Field key={f.name} label={f.label} required={f.required} hint={f.help}>
              <Input
                name={f.name}
                required={f.required}
                placeholder={f.placeholder}
                defaultValue={String(card.config?.[f.name] ?? '')}
              />
            </Field>
          ))}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setSettingsModal(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy !== null}>
              {busy === 'settings' ? 'Saving…' : 'Save'}
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

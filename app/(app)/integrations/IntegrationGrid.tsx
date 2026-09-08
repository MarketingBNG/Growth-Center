'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, Plug, RefreshCw, Settings2, Unplug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/patterns/field';
import { Modal } from '@/components/ui/modal';
import { StateBadge } from '@/components/patterns/integration-state';
import { api } from '@/lib/fetcher';
import { fmtNumber, fmtRelative } from '@/lib/format';
import type { Card as IntegrationCard } from '@/lib/integrations/service';

const CATEGORY_LABEL: Record<string, string> = {
  analytics: 'Analytics',
  ads: 'Advertising',
  social: 'Social',
  crm: 'CRM',
  seo: 'SEO',
  email: 'Email',
  work: 'Work tracking',
};

/** What the page polls for while something is syncing. Mirrors SyncStatus on the server. */
type LiveStatus = {
  provider: string;
  state: string;
  busy: boolean;
  detail: string | null;
  lastError: string | null;
};

/** How often the page asks whether a running sync is still running. */
const POLL_MS = 4000;

/**
 * Follows the syncs that are running on the server.
 *
 * The sync itself no longer runs in this tab — the route hands it to `after()` and it
 * chains through fresh invocations until it is done. So the page's job is to read that
 * state, not to drive it, and it has to read it on arrival as well as after a click: open
 * the page while a sync someone else started is running and the button must already say
 * Syncing.
 *
 * Polling rather than a stream: one small query every four seconds while a sync is in
 * flight and nothing at all when none is, which is not worth a socket. Background tabs
 * throttle timers to about a minute, which is why the poll also fires the moment the tab
 * becomes visible again — coming back to a stale idle button is the bug this fixes.
 */
function useLiveStatus(onSettled: () => void) {
  const [live, setLive] = useState<Record<string, LiveStatus>>({});
  const busyRef = useRef(false);
  // Held in a ref so the polling effect does not restart every time the callback's
  // identity changes, which would reset the interval on every render. Written in an
  // effect rather than during the render, which is the rule for refs.
  const settled = useRef(onSettled);
  useEffect(() => {
    settled.current = onSettled;
  }, [onSettled]);

  const poll = useCallback(async () => {
    try {
      const { providers } = await api<{ providers: LiveStatus[] }>('/api/integrations/sync-status');
      const next: Record<string, LiveStatus> = {};
      for (const p of providers) next[p.provider] = p;
      setLive(next);
      const anyBusy = providers.some((p) => p.busy);
      // The transition out of busy is the moment the imported rows, the row count and the
      // last-sync time are worth re-reading. Those come from the cached server render, so
      // it takes a refresh — done once here rather than on every poll.
      if (busyRef.current && !anyBusy) settled.current();
      busyRef.current = anyBusy;
    } catch {
      // A failed poll is not worth showing anyone: the next one is four seconds away, and
      // the card's own error line still carries whatever the sync itself reported.
    }
  }, []);

  useEffect(() => {
    // Off the render pass rather than in it: the first poll is a fetch that ends in a
    // setState, and starting it synchronously inside the effect cascades a render.
    const first = setTimeout(() => void poll(), 0);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void poll();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(first);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [poll]);

  // Polls only while something is actually syncing, so an idle page is idle.
  const anyBusy = Object.values(live).some((s) => s.busy);
  useEffect(() => {
    if (!anyBusy) return;
    const t = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(t);
  }, [anyBusy, poll]);

  return { live, poll };
}

export function IntegrationGrid({
  cards,
  canManage,
}: {
  cards: IntegrationCard[];
  canManage: boolean;
}) {
  const router = useRouter();
  const { live, poll } = useLiveStatus(() => router.refresh());
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
        <ProviderCard
          key={c.id}
          card={c}
          canManage={canManage}
          live={live[c.id] ?? null}
          onStarted={poll}
        />
      ))}
    </div>
  );
}

function ProviderCard({
  card,
  canManage,
  live,
  onStarted,
}: {
  card: IntegrationCard;
  canManage: boolean;
  /** Polled sync state, once it has arrived. Null until the first poll answers. */
  live: LiveStatus | null;
  /** Asks the page to poll immediately, so a click shows its result without the interval. */
  onStarted: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | 'connect' | 'sync' | 'disconnect' | 'settings'>(null);
  const [error, setError] = useState<string | null>(null);
  const [keyModal, setKeyModal] = useState(false);
  const [settingsModal, setSettingsModal] = useState(false);

  // The server is the authority on whether this is syncing, so a reload, a second tab and
  // a colleague's browser all show the same thing. `busy === 'sync'` covers only the
  // moment between the click and the first poll answering.
  const state = live?.state ?? card.state;
  const syncing = live ? live.busy : card.state === 'syncing';
  const spinning = syncing || busy === 'sync';
  // The running provider's own progress line — "1,200 of 39,412 records" — which used to
  // come back in the response the browser sat waiting on.
  const progress = syncing ? (live?.detail ?? null) : null;
  const lastError = live ? live.lastError : card.lastError;

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
  //
  // 'sync_paused' likewise: a backfill holding a cursor that nothing is driving is a
  // connected provider with more to fetch, and Sync now is what picks it up.
  const connected =
    state === 'connected' ||
    state === 'syncing' ||
    state === 'sync_stalled' ||
    state === 'sync_paused' ||
    (state === 'error' && card.hasCredential);

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
   * Starts a sync. Does not wait for it to finish.
   *
   * The slices run on the server now — the route hands them to `after()`, which chains
   * into fresh invocations for as long as the backfill needs. This tab used to be the
   * engine, calling the endpoint back until it reported done, which meant a
   * 39,000-record import survived only while the tab stayed open and in the foreground.
   * What is left here is a start and a poll.
   */
  async function run(action: 'sync' | 'disconnect') {
    setBusy(action);
    setError(null);
    try {
      await api(`/api/integrations/${card.id}/${action}`, { method: 'POST', json: {} });
      // Reflects the start immediately instead of waiting out the poll interval.
      onStarted();
      if (action === 'disconnect') router.refresh();
    } catch (e) {
      const message = (e as Error).message;
      // 409 is the server saying this provider is already syncing. Nothing went wrong and
      // nothing needs saying — the poll is about to show it running.
      if (action === 'sync' && /already syncing/i.test(message)) onStarted();
      else setError(message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex h-full flex-col rounded-2xl border border-border bg-card p-[18px] shadow-card">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="pb-0.5 text-micro font-bold uppercase tracking-[0.07em] text-muted-foreground">
            {CATEGORY_LABEL[card.category] ?? card.category}
          </p>
          <h3 className="text-lead font-bold tracking-tight">{card.name}</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{card.summary}</p>
        </div>
        <StateBadge state={state} />
      </div>

      <div className="flex flex-wrap gap-1 pt-3">
        {card.provides.map((p) => (
          <span
            key={p}
            className="rounded border border-border bg-secondary/50 px-1.5 py-0.5 text-micro text-muted-foreground"
          >
            {p}
          </span>
        ))}
      </div>

      <dl className="space-y-0.5 pt-3 text-meta">
        <Meta label="Auth" value={card.authKind === 'oauth2' ? 'OAuth' : 'API key'} />
        <Meta
          label="Last sync"
          value={
            state === 'demo_data'
              ? 'Seeded, not synced'
              : card.lastSyncAt
                ? `${fmtRelative(card.lastSyncAt)}${card.lastSyncRows !== null ? ` · ${fmtNumber(card.lastSyncRows)} ${card.lastSyncRows === 1 ? 'row' : 'rows'}` : ''}`
                : 'Never'
          }
        />
        {card.connectedByEmail ? (
          <Meta label="Connected by" value={card.connectedByEmail.split('@')[0]} />
        ) : null}
      </dl>

      {state === 'demo_data' ? (
        <p className="mt-3 rounded-md border border-warning/30 bg-warning/10 px-2 py-1.5 text-meta text-warning">
          Showing seeded demo figures. This is not a live connection.
        </p>
      ) : null}

      {lastError ? (
        <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-meta text-destructive">
          {lastError}
          {card.lastErrorAt ? (
            <span className="block opacity-70">{fmtRelative(card.lastErrorAt)}</span>
          ) : null}
        </p>
      ) : null}

      {card.hasCredential && card.credentialExpiresInDays !== null
        ? (() => {
            // Counted where the card was built, not here — see the field's note.
            const days = card.credentialExpiresInDays;
            if (days > 14) return null;
            return (
              <p className="mt-3 rounded-md border border-warning/30 bg-warning/10 px-2 py-1.5 text-meta text-warning">
                {days <= 0
                  ? 'The stored authorisation has expired. Reconnect.'
                  : `Authorisation expires in ${days} ${days === 1 ? 'day' : 'days'}. A sync renews it automatically.`}
              </p>
            );
          })()
        : null}

      {card.hasCredential && card.missingConfig.length > 0 ? (
        <p className="mt-3 rounded-md border border-warning/30 bg-warning/10 px-2 py-1.5 text-meta text-warning">
          Connected, but syncing needs {card.missingConfig.join(' and ')}. Open Settings.
        </p>
      ) : null}

      {card.missingEnv.length > 0 ? (
        <div className="mt-3 rounded-md border border-border bg-secondary/40 px-2 py-1.5">
          <p className="text-meta font-medium">Requires API credentials</p>
          <ul className="mt-0.5 space-y-0.5">
            {card.missingEnv.map((e) => (
              <li key={e.name} className="text-meta text-muted-foreground">
                <span className="font-mono">{e.name}</span> — {e.description}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? <p className="mt-3 text-meta text-destructive">{error}</p> : null}
      {spinning && !error ? (
        <p className="mt-3 text-meta text-muted-foreground">
          {progress ?? 'Syncing. This carries on if you close the tab.'}
        </p>
      ) : null}

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
        {!canManage ? (
          <p className="text-meta text-muted-foreground">
            Your role cannot change integrations.
          </p>
        ) : connected ? (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null || spinning}
              onClick={() => run('sync')}
            >
              <RefreshCw className={spinning ? 'animate-spin' : undefined} />
              {spinning ? 'Syncing…' : state === 'sync_paused' ? 'Resume sync' : 'Sync now'}
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
            {state === 'demo_data' ? (
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
            className="ml-auto inline-flex items-center gap-1 text-meta text-muted-foreground hover:text-foreground"
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

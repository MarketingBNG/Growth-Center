'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { api } from '@/lib/fetcher';
import { fmtRelative } from '@/lib/format';

type Item = {
  id: string;
  title: string;
  body: string | null;
  level: string;
  href: string | null;
  readAt: string | null;
  createdAt: string;
};

const LEVEL_DOT: Record<string, string> = {
  error: 'bg-destructive',
  warning: 'bg-warning',
  success: 'bg-success',
  info: 'bg-primary',
};

/**
 * Replaces a bell that did nothing and showed a permanent unread dot regardless of
 * state. Sync failures already wrote notification rows; nothing read them, so a nightly
 * sync could fail for weeks with no signal anywhere.
 */
export function Notifications() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ items: Item[]; unread: number }>('/api/notifications');
      setItems(r.items);
      setUnread(r.unread);
    } catch {
      // A failing bell must not break the shell around it.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Close on an outside click or Escape, the two ways anyone dismisses a popover.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next) return;

    setLoading(true);
    await load();
    setLoading(false);
  }

  async function markAllRead() {
    setUnread(0);
    setItems((prev) => prev.map((i) => ({ ...i, readAt: i.readAt ?? new Date().toISOString() })));
    try {
      await api('/api/notifications', { method: 'PATCH', json: {} });
    } catch {
      void load();
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        title="Notifications"
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        onClick={toggle}
        className="relative grid size-9 shrink-0 place-items-center rounded-[10px] border border-border bg-card text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        <Bell className="size-4" />
        {unread > 0 ? (
          <span className="absolute right-1 top-1 grid min-w-[15px] place-items-center rounded-full bg-destructive px-1 text-[9px] font-bold leading-[15px] text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-11 z-50 w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-card shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <p className="text-xs font-semibold">Notifications</p>
            {unread > 0 ? (
              <button
                type="button"
                onClick={markAllRead}
                className="text-[11px] text-muted-foreground hover:text-foreground"
              >
                Mark all read
              </button>
            ) : null}
          </div>

          <div className="max-h-[min(60vh,420px)] overflow-y-auto">
            {loading && items.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">Loading…</p>
            ) : items.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                Nothing yet. Failed syncs and automated alerts land here.
              </p>
            ) : (
              items.map((n) => {
                const inner = (
                  <>
                    <span
                      className={`mt-1.5 size-1.5 shrink-0 rounded-full ${LEVEL_DOT[n.level] ?? 'bg-muted-foreground'}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-medium">{n.title}</span>
                      {n.body ? (
                        <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
                          {n.body}
                        </span>
                      ) : null}
                      <span className="mt-0.5 block text-[10px] text-muted-foreground">
                        {fmtRelative(n.createdAt)}
                      </span>
                    </span>
                  </>
                );

                const className = `flex w-full items-start gap-2 border-b border-border px-3 py-2.5 text-left last:border-0 ${
                  n.readAt ? 'opacity-60' : 'bg-secondary/30'
                }`;

                return n.href ? (
                  <a key={n.id} href={n.href} className={`${className} hover:bg-secondary/60`}>
                    {inner}
                  </a>
                ) : (
                  <div key={n.id} className={className}>
                    {inner}
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

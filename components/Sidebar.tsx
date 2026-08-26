'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as Icons from 'lucide-react';
import { ChevronDown, ChevronUp, LogOut, PanelLeft, PanelLeftOpen, TrendingUp } from 'lucide-react';
import { signOut } from 'next-auth/react';
import { NAV } from '@/lib/nav';
import { cn } from '@/lib/utils';
import type { CurrentUser } from '@/lib/auth';

const OPEN_KEY = 'gc.sidebar.open';
const SECTIONS_KEY = 'gc.sidebar.sections';

function Icon({ name, className }: { name: string; className?: string }) {
  const Cmp = (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[name];
  return Cmp ? <Cmp className={className} /> : null;
}

/** Reads once on mount rather than during render: touching localStorage while rendering
 *  would make the server and client markup disagree. */
function usePersisted<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(fallback);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) setValue(JSON.parse(raw) as T);
    } catch {
      // A blocked or full localStorage is not worth breaking the shell over.
    }
    setReady(true);
  }, [key]);

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  }, [key, value, ready]);

  return [value, setValue] as const;
}

/** The full sidebar column: brand row, nav, user card. Owns its own collapse state so
 *  AppShell does not have to thread it through. */
export function Sidebar({ user }: { user: CurrentUser }) {
  const [open, setOpen] = usePersisted<boolean>(OPEN_KEY, true);

  return (
    <aside
      className={cn(
        'sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border bg-sidebar transition-[width] duration-[220ms] ease-out lg:flex',
        open ? 'w-[248px]' : 'w-[72px]',
      )}
    >
      <div
        className={cn(
          'flex h-16 items-center border-b border-line-soft',
          open ? 'gap-2.5 px-4' : 'justify-center px-0',
        )}
      >
        {open ? (
          <>
            <Link href="/" className="flex min-w-0 items-center gap-2.5">
              <span className="grid size-[30px] shrink-0 place-items-center rounded-[9px] bg-primary text-on-primary">
                <TrendingUp className="size-[17px]" />
              </span>
              <span className="whitespace-nowrap text-[15px] font-bold tracking-[-0.02em]">
                Growth Center
              </span>
            </Link>
            <button
              type="button"
              onClick={() => setOpen(false)}
              title="Collapse sidebar"
              aria-label="Collapse sidebar"
              className="ml-auto grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <PanelLeft className="size-4" />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            title="Expand sidebar"
            aria-label="Expand sidebar"
            className="grid size-[34px] place-items-center rounded-[9px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <PanelLeftOpen className="size-[18px]" />
          </button>
        )}
      </div>

      {/* overflow-x-hidden, or the 72px column grows a horizontal scrollbar. */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-2.5 pb-2 pt-3">
        <SidebarNav collapsed={!open} />
      </div>

      <UserCard user={user} collapsed={!open} />
    </aside>
  );
}

export function SidebarNav({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const [folded, setFolded] = usePersisted<Record<string, boolean>>(SECTIONS_KEY, {});

  return (
    <nav className="flex flex-col">
      {NAV.map((section, i) => {
        const key = section.title ?? 'main';
        // A collapsed sidebar hides the headers, so every section force-expands —
        // otherwise a folded section stays unreachable with no control to unfold it.
        const expanded = collapsed || !folded[key];

        return (
          <div key={`${key}-${i}`} className="mb-3.5">
            {section.title && !collapsed ? (
              <button
                type="button"
                onClick={() => setFolded({ ...folded, [key]: expanded })}
                aria-expanded={expanded}
                className="flex w-full items-center gap-1.5 px-2 pb-1.5 pt-1 text-muted-foreground transition-colors hover:text-foreground"
              >
                <span className="text-[10.5px] font-bold uppercase tracking-[0.09em]">
                  {section.title}
                </span>
                {expanded ? (
                  <ChevronUp className="ml-auto size-[13px]" />
                ) : (
                  <ChevronDown className="ml-auto size-[13px]" />
                )}
              </button>
            ) : null}

            {section.title && collapsed ? (
              <div className="mx-2.5 mb-2 mt-0.5 h-px bg-border" />
            ) : null}

            {expanded ? (
              <ul className="flex flex-col gap-0.5">
                {section.items.map((item) => {
                  const active =
                    item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onNavigate}
                        aria-current={active ? 'page' : undefined}
                        title={collapsed ? item.label : undefined}
                        aria-label={collapsed ? item.label : undefined}
                        className={cn(
                          'flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[13px] transition-colors',
                          collapsed && 'justify-center',
                          active
                            ? 'bg-primary-soft font-bold text-primary'
                            : 'font-medium text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                        )}
                      >
                        <Icon name={item.icon} className="size-4 shrink-0" />
                        {collapsed ? null : (
                          <span className="truncate whitespace-nowrap">{item.label}</span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}

export function UserCard({ user, collapsed = false }: { user: CurrentUser; collapsed?: boolean }) {
  return (
    <div
      className={cn(
        'flex items-center gap-2.5 border-t border-line-soft p-3',
        collapsed && 'justify-center',
      )}
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary-soft text-[11.5px] font-bold text-info-strong">
        {user.initials}
      </span>
      {collapsed ? null : (
        <>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px] font-semibold">{user.name}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {user.displayRole ?? user.role}
            </p>
          </div>
          <button
            type="button"
            title="Sign out"
            aria-label="Sign out"
            className="grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            onClick={() => signOut({ callbackUrl: '/signin' })}
          >
            <LogOut className="size-[15px]" />
          </button>
        </>
      )}
    </div>
  );
}

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Bell, Menu, Search, TriangleAlert, TrendingUp, X } from 'lucide-react';
import { Sidebar, SidebarNav, UserCard } from './Sidebar';
import { ThemeToggle } from './ThemeToggle';
import { Button } from './ui/button';
import type { CurrentUser } from '@/lib/auth';

export function AppShell({
  user,
  demoData = false,
  children,
}: {
  user: CurrentUser;
  /** True when at least one integration is still on seeded data. Drives the header pill. */
  demoData?: boolean;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar user={user} />

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            aria-label="Close navigation"
            className="absolute inset-0 bg-black/60"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative flex h-full w-64 flex-col border-r border-border bg-sidebar">
            <Link href="/" className="flex h-16 items-center gap-2.5 border-b border-line-soft px-4">
              <span className="grid size-[30px] shrink-0 place-items-center rounded-[9px] bg-primary text-on-primary">
                <TrendingUp className="size-[17px]" />
              </span>
              <span className="text-[15px] font-bold tracking-[-0.02em]">Growth Center</span>
            </Link>
            <div className="flex-1 overflow-y-auto overflow-x-hidden px-2.5 pb-2 pt-3">
              <SidebarNav onNavigate={() => setMobileOpen(false)} />
            </div>
            <UserCard user={user} />
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-4 border-b border-border bg-card px-4 lg:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
          >
            {mobileOpen ? <X /> : <Menu />}
          </Button>

          <label className="hidden h-[38px] w-full max-w-[420px] items-center gap-2.5 rounded-[10px] border border-border bg-background px-3 text-muted-foreground sm:flex">
            <Search className="size-[15px] shrink-0" />
            <input
              placeholder="Search leads, deals, campaigns…"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
            />
            <span className="hidden shrink-0 rounded-md border border-border bg-card px-1.5 py-0.5 text-[10.5px] font-semibold md:inline">
              ⌘K
            </span>
          </label>

          <div className="ml-auto flex items-center gap-2">
            {/* Load-bearing: the figures below are seeded until a source is connected, and
                this is the only thing on most screens that says so. */}
            {demoData ? (
              <span className="hidden items-center gap-1.5 whitespace-nowrap rounded-full border border-warning bg-warning-soft px-2.5 py-[5px] text-[11px] font-semibold text-warning-strong md:inline-flex">
                <TriangleAlert className="size-3" />
                Demo data · no source connected
              </span>
            ) : null}

            <ThemeToggle />

            <button
              type="button"
              title="Notifications"
              aria-label="Notifications"
              className="relative grid size-9 shrink-0 place-items-center rounded-[10px] border border-border bg-card text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Bell className="size-4" />
              <span className="absolute right-2 top-2 size-1.5 rounded-full bg-destructive" />
            </button>

            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[linear-gradient(140deg,var(--chart-1),var(--chart-6))] text-[12px] font-bold text-white">
              {user.initials}
            </span>
          </div>
        </header>

        <main className="min-w-0 flex-1 px-6 pb-10 pt-6">{children}</main>
      </div>
    </div>
  );
}

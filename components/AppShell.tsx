'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Menu, X, LogOut, TrendingUp } from 'lucide-react';
import { signOut } from 'next-auth/react';
import { SidebarNav } from './Sidebar';
import { Button } from './ui/button';
import type { CurrentUser } from '@/lib/auth';

export function AppShell({ user, children }: { user: CurrentUser; children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-sidebar lg:flex">
        <Brand />
        <div className="flex-1 overflow-y-auto">
          <SidebarNav />
        </div>
        <UserCard user={user} />
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            aria-label="Close navigation"
            className="absolute inset-0 bg-black/60"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative flex h-full w-64 flex-col border-r border-border bg-sidebar">
            <Brand />
            <div className="flex-1 overflow-y-auto">
              <SidebarNav onNavigate={() => setMobileOpen(false)} />
            </div>
            <UserCard user={user} />
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-3 border-b border-border px-4 lg:hidden">
          <Button variant="ghost" size="icon" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            {mobileOpen ? <X /> : <Menu />}
          </Button>
          <span className="text-sm font-semibold">Growth Center</span>
        </header>
        <main className="min-w-0 flex-1 px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex h-14 items-center gap-2 border-b border-border px-4">
      <span className="grid size-7 place-items-center rounded-md bg-primary/15 text-primary">
        <TrendingUp className="size-4" />
      </span>
      <span className="text-sm font-semibold tracking-tight">Growth Center</span>
    </Link>
  );
}

function UserCard({ user }: { user: CurrentUser }) {
  return (
    <div className="flex items-center gap-2.5 border-t border-border px-3 py-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold">
        {user.initials}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">{user.name}</p>
        <p className="truncate text-[11px] text-muted-foreground">{user.displayRole ?? user.role}</p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        aria-label="Sign out"
        onClick={() => signOut({ callbackUrl: '/signin' })}
      >
        <LogOut className="size-3.5" />
      </Button>
    </div>
  );
}

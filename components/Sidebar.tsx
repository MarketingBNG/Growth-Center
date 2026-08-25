'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as Icons from 'lucide-react';
import { NAV } from '@/lib/nav';
import { cn } from '@/lib/utils';

function Icon({ name, className }: { name: string; className?: string }) {
  const Cmp = (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[name];
  return Cmp ? <Cmp className={className} /> : null;
}

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-5 px-3 py-4">
      {NAV.map((section, i) => (
        <div key={section.title ?? i}>
          {section.title ? (
            <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              {section.title}
            </p>
          ) : null}
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const active =
                item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors',
                      active
                        ? 'bg-primary/12 font-medium text-primary'
                        : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                    )}
                  >
                    <Icon name={item.icon} className="size-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

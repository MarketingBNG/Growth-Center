'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useHydrated } from './use-persisted';

/** Renders the icon only after mount: the server has no idea which theme the browser
 *  restored, so painting one on the first pass guarantees a hydration mismatch. */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useHydrated();

  const dark = resolvedTheme === 'dark';

  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      title="Toggle theme"
      aria-label={mounted ? (dark ? 'Switch to light theme' : 'Switch to dark theme') : 'Toggle theme'}
      className="grid size-9 shrink-0 place-items-center rounded-[10px] border border-border bg-card text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
    >
      {mounted ? dark ? <Sun className="size-4" /> : <Moon className="size-4" /> : <span className="size-4" />}
    </button>
  );
}

'use client';

import { useState } from 'react';
import { ArrowUp, Maximize2, Paperclip } from 'lucide-react';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/fetcher';
import { cn } from '@/lib/utils';

/**
 * The dashboard's ask-anything card, backed by the same `/api/ai/ask` route the AI
 * Insights page uses.
 *
 * When no key is configured the input is disabled and says why, rather than accepting a
 * question that goes nowhere — the same rule the integrations follow.
 */
export function AiAssistantCard({ configured }: { configured: boolean }) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    const q = question.trim();
    if (!q || !configured) return;
    setBusy(true);
    setError(null);
    setAnswer(null);
    try {
      const result = await api<{ answer: string; model: string }>('/api/ai/ask', {
        method: 'POST',
        json: { question: q },
      });
      setAnswer(result.answer);
      setQuestion('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="px-5 pb-5 pt-[18px]">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[14.5px] font-bold leading-tight tracking-tight">AI Assistant</h3>
        <Link
          href="/ai"
          title="Open AI Insights"
          aria-label="Open AI Insights"
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          <Maximize2 className="size-4" />
        </Link>
      </div>

      <div className="flex flex-col items-center pt-4">
        {/* Dimmed when there is no key behind it, so the card does not look live. */}
        <div
          aria-hidden
          className={cn(
            'size-[86px] rounded-full',
            'bg-[radial-gradient(circle_at_32%_28%,#9dc0ff,var(--primary)_58%,#1b3fa8)]',
            'shadow-[0_0_0_12px_rgba(47,107,246,.08),0_0_44px_rgba(47,107,246,.4)]',
            configured
              ? 'opacity-100 motion-safe:animate-[float_4.5s_ease-in-out_infinite]'
              : 'opacity-40',
          )}
        />
        <p className="pt-3 text-center text-xs text-muted-foreground">
          {configured
            ? 'Ask anything about your growth numbers.'
            : 'Set ANTHROPIC_API_KEY to ask questions about your numbers.'}
        </p>
      </div>

      {answer ? (
        <p className="mt-3 whitespace-pre-wrap rounded-xl bg-surface-sunken p-3 text-[12px] leading-relaxed">
          {answer}
        </p>
      ) : null}
      {error ? <p className="mt-3 text-[11.5px] text-destructive">{error}</p> : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask();
        }}
        className="mt-3.5 flex items-center gap-2 rounded-full border border-border bg-surface-sunken px-3 py-1.5"
      >
        <Paperclip className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <Input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={!configured || busy}
          placeholder={configured ? 'Ask a question…' : 'Unavailable — no API key'}
          aria-label="Ask the assistant a question"
          // The pill row supplies the border and ground, so the Input drops its own.
          className="h-auto min-w-0 flex-1 rounded-none border-0 bg-transparent px-0 text-[12.5px] focus-visible:ring-0"
        />
        <Button
          type="submit"
          size="icon"
          disabled={!configured || busy || !question.trim()}
          aria-label="Send"
          className="size-[30px] shrink-0 rounded-full shadow-none"
        >
          <ArrowUp className="size-4" />
        </Button>
      </form>
    </Card>
  );
}

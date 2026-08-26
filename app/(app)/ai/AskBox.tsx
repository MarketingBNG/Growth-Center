'use client';

import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/input';
import { api } from '@/lib/fetcher';
import { SUGGESTED_QUESTIONS } from '@/lib/enums';

export function AskBox({ configured }: { configured: boolean }) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [model, setModel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(q: string) {
    if (!q.trim()) return;
    setBusy(true);
    setError(null);
    setAnswer(null);
    try {
      const result = await api<{ answer: string; model: string; truncated?: boolean }>('/api/ai/ask', {
        method: 'POST',
        json: { question: q.trim() },
      });
      setAnswer(result.answer);
      setTruncated(!!result.truncated);
      setModel(result.model);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ask about the numbers</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(question);
          }}
          className="space-y-2"
        >
          <Textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={2}
            placeholder={configured ? 'Which channel produces our best customers?' : 'Configure ANTHROPIC_API_KEY to ask questions'}
            disabled={!configured || busy}
          />
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={!configured || busy || !question.trim()}>
              <Sparkles /> {busy ? 'Thinking…' : 'Ask'}
            </Button>
          </div>
        </form>

        <div className="flex flex-wrap gap-1.5">
          {SUGGESTED_QUESTIONS.map((q) => (
            <button
              key={q}
              onClick={() => {
                setQuestion(q);
                if (configured) ask(q);
              }}
              disabled={busy || !configured}
              className="rounded-md border border-border px-2 py-1 text-left text-[11px] text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              {q}
            </button>
          ))}
        </div>

        {error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        ) : null}

        {answer ? (
          <div className="rounded-md border border-border bg-secondary/30 px-3 py-2.5">
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{answer}</p>
            {/* A cut-off answer used to be shown as if it were complete. */}
            {truncated ? (
              <p className="mt-2 rounded border border-warning/30 bg-warning/10 px-2 py-1 text-[11px] text-warning">
                This answer hit the length limit and stops mid-thought. Ask something
                narrower for a complete one.
              </p>
            ) : null}
            {model ? (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Answered by {model} from the growth snapshot only.
              </p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

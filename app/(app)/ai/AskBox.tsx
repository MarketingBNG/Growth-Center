'use client';

import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/input';
import { api } from '@/lib/fetcher';
import { AnswerText } from '@/components/patterns/answer-text';
import { AI_KEY_ENV, SUGGESTED_QUESTIONS } from '@/lib/enums';

export function AskBox({ configured }: { configured: boolean }) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [model, setModel] = useState<string | null>(null);
  const [usage, setUsage] = useState<{ input: number; output: number; total: number } | null>(null);
  const [queries, setQueries] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(q: string) {
    if (!q.trim()) return;
    setBusy(true);
    setError(null);
    setAnswer(null);
    try {
      const result = await api<{
        answer: string;
        model: string;
        truncated?: boolean;
        usage?: { input: number; output: number; total: number };
        queries?: string[];
      }>('/api/ai/ask', {
        method: 'POST',
        json: { question: q.trim() },
      });
      setAnswer(result.answer);
      setTruncated(!!result.truncated);
      setModel(result.model);
      setUsage(result.usage ?? null);
      setQueries(result.queries ?? []);
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
            placeholder={configured ? 'Which channel produces our best customers?' : `Configure ${AI_KEY_ENV} to ask questions`}
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
            <AnswerText text={answer} />
            {/* A cut-off answer used to be shown as if it were complete. */}
            {truncated ? (
              <p className="mt-2 rounded border border-warning/30 bg-warning/10 px-2 py-1 text-[11px] text-warning">
                This answer hit the length limit and stops mid-thought. Ask something
                narrower for a complete one.
              </p>
            ) : null}
            {model ? (
              <p className="mt-2 text-[11px] text-muted-foreground">
                {/* The wording has to follow what actually happened: "from the snapshot
                    only" was a promise the answer no longer keeps once the model has read
                    the database, and the reader is entitled to know which it was. */}
                {queries.length
                  ? `Answered by ${model} after ${queries.length} ${queries.length === 1 ? 'lookup' : 'lookups'} (${[...new Set(queries)].join(', ')}).`
                  : `Answered by ${model} from the growth snapshot only.`}
                {/* Every question spends real money and nothing on screen said how much,
                    so the only way to find out was the vendor's bill at the end of the
                    month. Output covers the model's reasoning as well as the text above,
                    which is why it can exceed what you can see. */}
                {usage ? (
                  <>
                    {' '}
                    {usage.input.toLocaleString('en-US')} tokens in,{' '}
                    {usage.output.toLocaleString('en-US')} out.
                  </>
                ) : null}
              </p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

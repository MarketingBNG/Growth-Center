import { Fragment } from 'react';
import { parseAnswer } from '@/lib/answer-format';

// Renders the light markdown the model actually writes: paragraphs, bullets, numbered
// lists, `**bold**` and `` `code` ``. Before this, answers were dropped into a
// `whitespace-pre-wrap` paragraph, so a reader got literal asterisks —
// "**Landing Page** appears to produce **4 customers from 4 leads (100%)**" — which is
// worse than plain text, because the emphasis markers land exactly on the figures.
//
// Hand-rolled rather than a markdown dependency, for two reasons. The grammar is four
// constructs wide and fully known: it is what our own prompt asks for. And output goes
// through React elements, never `dangerouslySetInnerHTML`, so a model that emits a script
// tag renders it as the text it is. A general markdown renderer would be more capable and
// would also be a larger surface to trust with untrusted output.

/** Splits on `**bold**` and `` `code` `` and returns real elements, never HTML. */
function inline(text: string, keyPrefix: string) {
  // One pass, alternating: the capture groups make split() return the delimited content
  // interleaved with the plain text around it.
  const parts = text.split(/\*\*([^*]+)\*\*|`([^`]+)`/g);

  return parts.map((part, i) => {
    if (part === undefined || part === '') return null;
    // split() with two groups yields [plain, bold, code, plain, bold, code, ...]
    const slot = i % 3;
    const key = `${keyPrefix}-${i}`;
    if (slot === 1) return <strong key={key} className="font-semibold text-foreground">{part}</strong>;
    if (slot === 2) {
      return (
        <code key={key} className="rounded bg-secondary px-1 py-0.5 font-mono text-[0.9em]">
          {part}
        </code>
      );
    }
    return <Fragment key={key}>{part}</Fragment>;
  });
}

export function AnswerText({ text }: { text: string }) {
  const blocks = parseAnswer(text);

  return (
    <div className="space-y-2.5 text-sm leading-relaxed">
      {blocks.map((block, b) =>
        block.kind === 'list' ? (
          <ul
            key={b}
            className={
              block.ordered
                ? 'list-decimal space-y-1 pl-5 marker:text-muted-foreground'
                : 'list-disc space-y-1 pl-5 marker:text-muted-foreground'
            }
          >
            {block.items.map((item, i) => (
              <li key={i} className="pl-0.5">{inline(item, `${b}-${i}`)}</li>
            ))}
          </ul>
        ) : (
          // Joined with a space, not a newline: the model hard-wraps prose, and preserving
          // those breaks put a line ending mid-sentence at whatever width it chose.
          <p key={b}>{inline(block.lines.join(' '), String(b))}</p>
        ),
      )}
    </div>
  );
}

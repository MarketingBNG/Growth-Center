// Groups the light markdown the model writes into blocks a renderer can walk.
//
// Split from the component for the same reason lib/list-query.ts is split from lib/api.ts:
// node --experimental-strip-types cannot load JSX, so a parser living in a .tsx file cannot
// be unit-tested at all. The decisions are all here; the .tsx file only turns these blocks
// into elements.

export type Block =
  | { kind: 'para'; lines: string[] }
  | { kind: 'list'; ordered: boolean; items: string[] };

/** Groups lines into paragraphs and lists. */
export function parseAnswer(text: string): Block[] {
  const blocks: Block[] = [];
  // Whether the previous line can still be continued. A blank line ends a paragraph, but
  // NOT a list — models put blank lines between bullets, and treating that as two lists
  // renders two sets of markers for what the reader sees as one list.
  let paraOpen = false;

  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();
    const last = blocks[blocks.length - 1];

    if (!line) {
      paraOpen = false;
      continue;
    }

    const bullet = line.match(/^[-*•]\s+(.*)$/);
    const numbered = line.match(/^\d+[.)]\s+(.*)$/);

    if (bullet || numbered) {
      const ordered = !!numbered;
      const item = (bullet?.[1] ?? numbered?.[1] ?? '').trim();
      if (last?.kind === 'list' && last.ordered === ordered) last.items.push(item);
      else blocks.push({ kind: 'list', ordered, items: [item] });
      paraOpen = false;
      continue;
    }

    // A heading is written as a bold line on its own; there is no separate heading block,
    // because `inline` already renders the emphasis and a fifth construct would be one
    // more thing to get wrong.
    if (paraOpen && last?.kind === 'para') last.lines.push(line);
    else blocks.push({ kind: 'para', lines: [line] });
    paraOpen = true;
  }

  return blocks;
}


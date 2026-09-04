// Turning stored email HTML into readable text.
//
// Lives on its own rather than inside lib/outreach.ts because two things need it and they
// must not import each other: outreach.ts reads sequences from the database, and
// outreach-lint.ts is framework-free so a test can import it directly. Having the lint
// reach into outreach.ts for this made a cycle between them.

const ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
};

/**
 * A step body as readable text.
 *
 * Smartlead stores the composed email, which is HTML — 120 of the 121 imported steps are
 * markup, one of them 33KB of it. Rendered as text that printed
 * `<div><strong style="font-weight: 700">` down the card, and the page shipped 2.7MB of
 * escaped tags for a preview nobody could read. Tags become spacing, entities become
 * characters, and the result is trimmed, because a card is not an email client.
 */
export function preview(html: string, max = 500): string {
  const text = html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    // Block ends are the only line breaks worth keeping; everything else collapses.
    .replace(/<\/(p|div|li|tr|h[1-6])\s*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#?\w+);/g, (m, e: string) => ENTITIES[e.toLowerCase()] ?? ENTITIES[e] ?? m)
    .replace(/[^\S\n]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    // Blank lines dropped, not kept: the card shows the first few lines of the step, and
    // an empty one spends a line of that budget on nothing.
    .filter((l) => l)
    .join('\n');
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

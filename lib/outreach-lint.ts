// Deterministic checks over an outreach template.
//
// §14.6 of the Build and Operating Manual: a linter cannot be tired or in a hurry, and it
// is the control that makes the one-off clean-up of §14.1 permanent. Nothing here asks a
// model anything — every finding is a regex over stored text, so it is reproducible, free,
// and explainable to whoever has to act on it.
//
// Framework-free on purpose: no Prisma, no React, so tools/outreach-lint.test.ts imports it
// directly and the same function can run in a page, in a job, or in a check before a
// sequence is allowed to display as active.
//
// The rules below were written against the 121 steps actually in this workspace, not
// against what Smartlead's documentation says a template looks like. That inventory is
// what separates {{first_name}}, which is a real merge field the platform resolves, from
// {{Subject}}, which is scaffolding somebody pasted and nothing will ever fill in.

import { preview } from './html-text.ts';

export type LintSeverity = 'critical' | 'review';

export type LintCode =
  | 'scaffolding-token'
  | 'suspect-token'
  | 'placeholder'
  | 'missing-subject'
  | 'unverified-figure';

export type LintFinding = {
  code: LintCode;
  severity: LintSeverity;
  /** One line, addressed to whoever has to fix it. */
  message: string;
  /** The offending text, so the finding points at something rather than describing it. */
  excerpt: string;
  field: 'subject' | 'body';
  stepPosition: number;
};

export type LintableStep = {
  position: number;
  subject: string | null;
  body: string;
};

/**
 * A merge field the sending platform will actually resolve.
 *
 * Smartlead's fields are snake_case identifiers. Everything else in this workspace's
 * templates turned out to be a leak rather than a field — including four spellings with a
 * space in them and one outright typo. The shape is the test, not a list of names: a list
 * would need editing every time somebody adds a custom field, and would fail closed on
 * the ones it had not heard of.
 */
const VALID_FIELD = /^[a-z][a-z0-9_]*$/;

/**
 * Tokens that are template scaffolding rather than a mistyped field: the word the editor
 * itself uses for the part you are supposed to replace. These are never a custom field
 * anyone defined, so they are the certain half of the token findings.
 *
 * `subejct` is deliberate. It is in the live data.
 */
const SCAFFOLDING = /^(subject|body|subejct|subject[_\s]?line|body[_\s]?line|custom field name.*)$/i;

const TOKEN = /\{\{([^}]*)\}\}/g;

/** `[final date]`, `[Company Name]`, `[Link]` — all three are in the live templates. */
const BRACKETED = /\[[^\]\n]{0,40}\]/g;

/** A currency amount or a percentage: in this firm's copy, almost always a claim. */
const FIGURE =
  /(?:[$₹£€]\s?\d[\d,]*(?:\.\d+)?)|(?:\b(?:USD|INR|EUR|GBP|Rs\.?)\s?\d[\d,]*(?:\.\d+)?)|(?:\b\d+(?:\.\d+)?\s?%)/gi;

/** Everything the checks read: tags stripped, entities decoded, nothing truncated. */
function readable(html: string): string {
  return preview(html, Number.MAX_SAFE_INTEGER);
}

function unique(values: string[], cap = 6): string[] {
  return [...new Set(values)].slice(0, cap);
}

function checkTokens(text: string, field: 'subject' | 'body', position: number): LintFinding[] {
  const out: LintFinding[] = [];
  for (const match of text.matchAll(TOKEN)) {
    const inner = (match[1] ?? '').trim();
    if (VALID_FIELD.test(inner)) continue;

    const scaffolding = SCAFFOLDING.test(inner) || inner.includes(' ');
    out.push({
      code: scaffolding ? 'scaffolding-token' : 'suspect-token',
      severity: scaffolding ? 'critical' : 'review',
      message: scaffolding
        ? `${match[0]} is not a merge field — it will send exactly as written.`
        : `${match[0]} is not in the platform's field format; confirm it resolves.`,
      excerpt: match[0],
      field,
      stepPosition: position,
    });
  }
  return out;
}

/**
 * Lints one step.
 *
 * `isFirstStep` decides whether an empty subject is a defect. A follow-up sent into the
 * same thread carries no subject by design — 37 of the 38 blank subjects in this workspace
 * are exactly that, and flagging them would bury the one that is real.
 */
export function lintStep(step: LintableStep, isFirstStep: boolean): LintFinding[] {
  const findings: LintFinding[] = [];
  const subject = (step.subject ?? '').trim();
  const body = readable(step.body ?? '');

  if (isFirstStep && !subject) {
    findings.push({
      code: 'missing-subject',
      severity: 'critical',
      message: 'The opening email has no subject line.',
      excerpt: '',
      field: 'subject',
      stepPosition: step.position,
    });
  }

  // A subject stored as the words the UI shows for an empty one. None in this workspace
  // today — what the audit saw was this app's own display fallback — but a template
  // copied out of a screenshot would carry it, and it is one line to be sure.
  if (/^\(?no subject\)?$/i.test(subject)) {
    findings.push({
      code: 'placeholder',
      severity: 'critical',
      message: 'The subject is the placeholder text "(no subject)".',
      excerpt: subject,
      field: 'subject',
      stepPosition: step.position,
    });
  }

  findings.push(...checkTokens(subject, 'subject', step.position));
  findings.push(...checkTokens(body, 'body', step.position));

  for (const field of [
    { text: subject, name: 'subject' as const },
    { text: body, name: 'body' as const },
  ]) {
    const brackets = unique([...field.text.matchAll(BRACKETED)].map((m) => m[0]));
    for (const excerpt of brackets) {
      findings.push({
        code: 'placeholder',
        severity: 'critical',
        message: `${excerpt} looks like a placeholder nobody filled in.`,
        excerpt,
        field: field.name,
        stepPosition: step.position,
      });
    }

    const figures = unique([...field.text.matchAll(FIGURE)].map((m) => m[0].trim()));
    if (figures.length) {
      findings.push({
        code: 'unverified-figure',
        severity: 'review',
        // Not "this figure is wrong" — the linter cannot know. It knows the figure is
        // going out at volume with the firm's name on it and has no verification on
        // record, which is the thing worth saying.
        message: `Carries ${figures.length === 1 ? 'a figure' : `${figures.length} figures`} (${figures.join(', ')}) with no verification recorded.`,
        excerpt: figures.join(', '),
        field: field.name,
        stepPosition: step.position,
      });
    }
  }

  return findings;
}

/**
 * Lints a whole sequence.
 *
 * The first step is the one with the lowest position rather than position 1 — Smartlead's
 * positions start at 1 here, but the page already learned not to assume that, and a
 * sequence whose opening step was deleted would otherwise have no first step at all.
 */
export function lintSequence(steps: LintableStep[]): LintFinding[] {
  if (!steps.length) return [];
  const first = Math.min(...steps.map((s) => s.position));
  return steps.flatMap((s) => lintStep(s, s.position === first));
}

export type LintSummary = {
  critical: number;
  review: number;
  findings: LintFinding[];
};

export function summarise(findings: LintFinding[]): LintSummary {
  return {
    critical: findings.filter((f) => f.severity === 'critical').length,
    review: findings.filter((f) => f.severity === 'review').length,
    findings,
  };
}

/**
 * Would this template be allowed to go out?
 *
 * The manual's rule is that a placeholder template cannot be activated. The app cannot
 * enforce that today — Smartlead owns the sending, and `Sequence.status` is overwritten
 * from it on every sync — so this is the honest half: the app can say, on the record and
 * in one place, that a sequence is not fit to send. Somebody still has to pause it there.
 */
export function blocksSending(findings: LintFinding[]): boolean {
  return findings.some((f) => f.severity === 'critical');
}

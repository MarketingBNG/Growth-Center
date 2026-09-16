import { z } from 'zod';

/**
 * Field shapes that every schema in the app was restating.
 *
 * `z.string().trim().email()` appeared nineteen times across eleven files, in four
 * different suffix orderings for the same intent — and only three of them capped the
 * length. An address is at most 254 characters by RFC 5321, so an uncapped field is an
 * unbounded string reaching the database; the three that already said `.max(200)` were
 * right and the rest were an oversight, not a decision.
 *
 * 200 rather than 254 because that is the number the three existing fields chose, the
 * column they write to, and a bound no real address comes near.
 */
export const EMAIL_MAX = 200;

/** A trimmed, validated, length-capped email address. Callers add `.optional()`,
 *  `.nullable()` or `.or(z.literal(''))` as their own field requires. */
export const email = () => z.string().trim().email().max(EMAIL_MAX);

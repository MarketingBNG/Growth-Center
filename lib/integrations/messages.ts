/**
 * The sentences every provider says when a vendor refuses it.
 *
 * Three of them recur across nine adapters, written out by hand each time and identical
 * to the word: the token was rejected, the vendor is throttling us, the request simply
 * failed. Worth having in one place mostly so they stay identical — the value of "It will
 * resume on the next run." is that somebody reads it on one integration, learns it means
 * "do nothing", and is right about the others too. Three different phrasings of that
 * would each have to be learned separately.
 *
 * Deliberately NOT a shared describeError(). Each adapter's ladder above these lines is
 * the part that carries the knowledge — that a Google Ads developer token stuck on Test
 * Account access is the usual cause of a failed first sync, that a 403 from Business
 * Profile means a per-project review rather than bad credentials, that LinkedIn gates
 * every advertising endpoint behind Marketing Developer Platform approval. Those ladders
 * differ in their cases, their order and their fallbacks, and folding them into one
 * function with a strategy argument per difference would be more code hiding exactly the
 * detail that makes the message worth reading. One factory would flatten all of it.
 */

/**
 * The message a vendor put in a failed response, if it put one there.
 *
 * Google and Meta both answer a failure with `{ error: { message } }`, and six adapters
 * read it with the same cast and the same `.catch(() => null)` — the catch matters, because
 * the body of a 500 is as often an HTML error page as it is JSON, and a parse failure
 * there would replace the vendor's status with a SyntaxError.
 *
 * Returns null when there is nothing to quote, which is what each caller's own fallback is
 * for: what to say instead is provider knowledge and stays with the provider.
 */
export async function vendorMessage(res: Response): Promise<string | null> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return body?.error?.message ?? null;
}

/** A 401: the credential is no longer good and a person has to reconnect. */
export const tokenRejected = (vendor: string): string =>
  `${vendor} rejected the token. Reconnect the integration.`;

/**
 * A 429. Says the sync will pick itself up, because the alternative reading — that
 * something is broken and wants attention — is what gets a working integration
 * disconnected and reconnected at midnight.
 *
 * `subject` is who is throttling; `what` narrows it where one vendor throttles several
 * APIs separately, as Google does for Business Profile and PageSpeed.
 */
export const rateLimited = (subject: string, what?: string): string =>
  `${subject} is rate-limiting ${what ? `${what} ` : ''}requests. It will resume on the next run.`;

/** Everything else, with the status kept: it is the only thing that separates a vendor
 *  outage from a bad request when somebody reports the message second-hand. */
export const requestFailed = (product: string, status: number): string =>
  `${product} request failed (${status}).`;

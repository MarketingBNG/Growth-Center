import { listQuery, type ListQuery } from './list-query.ts';

/**
 * Server components receive searchParams as a plain record. This validates it with the
 * same schema the API routes use, so a hand-edited URL cannot reach a query.
 */
export function pageQuery(params: Record<string, string | string[] | undefined>): ListQuery {
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === 'string') flat[k] = v;
    else if (Array.isArray(v) && v[0]) flat[k] = v[0];
  }
  const parsed = listQuery.safeParse(flat);
  return parsed.success ? parsed.data : listQuery.parse({});
}

export function pick<T extends Record<string, unknown>>(
  params: Record<string, string | string[] | undefined>,
  keys: readonly string[],
): T {
  const out: Record<string, string> = {};
  for (const key of keys) {
    const v = params[key];
    if (typeof v === 'string' && v) out[key] = v;
  }
  return out as T;
}

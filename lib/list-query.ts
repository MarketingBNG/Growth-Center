import { z } from 'zod';

// The list/pagination/sort contract, split out of lib/api.ts.
//
// Everything here is pure and imports nothing but zod. lib/api.ts imports `next/server`
// for NextResponse, which bare Node cannot resolve — so while these lived there, neither
// they nor lib/query.ts could be unit-tested, despite being the boundary that turns
// caller-supplied query strings into database arguments. lib/api.ts re-exports all of it,
// so route handlers keep importing from '@/lib/api' unchanged.

export const listQuery = z.object({
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.string().max(40).optional(),
  dir: z.enum(['asc', 'desc']).default('desc'),
});

export type ListQuery = z.infer<typeof listQuery>;

export function parseQuery<S extends z.ZodType>(req: Request, schema: S): z.infer<S> {
  return schema.parse(Object.fromEntries(new URL(req.url).searchParams));
}

export type Paged<T> = { rows: T[]; total: number; page: number; perPage: number };

export function paged<T>(rows: T[], total: number, q: ListQuery): Paged<T> {
  return { rows, total, page: q.page, perPage: q.perPage };
}

/** Prisma skip/take from a validated page/perPage pair. */
export function slice(q: ListQuery) {
  return { skip: (q.page - 1) * q.perPage, take: q.perPage };
}

/**
 * Restricts a caller-supplied sort column to an allow-list, so `?sort=` cannot reach
 * an arbitrary field.
 */
export function orderBy<K extends string>(q: ListQuery, allowed: readonly K[], fallback: K) {
  const key = (allowed as readonly string[]).includes(q.sort ?? '') ? (q.sort as K) : fallback;
  return { [key]: q.dir } as Record<K, 'asc' | 'desc'>;
}

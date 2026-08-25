import { NextResponse } from 'next/server';
import { z } from 'zod';
import { HttpError, requirePermission, requireUser, type CurrentUser } from './auth.ts';
import type { Permission } from './roles.ts';

export type ApiError = { error: string; detail?: unknown };

export function fail(status: number, error: string, detail?: unknown) {
  return NextResponse.json<ApiError>({ error, ...(detail ? { detail } : {}) }, { status });
}

/**
 * Wraps a route handler so every route reports errors the same way and no handler can
 * forget its authorization check — the permission is an argument, not a convention.
 */
export function route<T, C = unknown>(
  permission: Permission | null,
  handler: (user: CurrentUser, req: Request, ctx: C) => Promise<T>,
) {
  return async (req: Request, ctx: C) => {
    try {
      const user = permission ? await requirePermission(permission) : await requireUser();
      return NextResponse.json(await handler(user, req, ctx));
    } catch (e) {
      if (e instanceof HttpError) return fail(e.status, e.message);
      if (e instanceof z.ZodError) return fail(422, 'Invalid input', z.treeifyError(e));
      const message = (e as Error).message ?? 'Unexpected error';
      if (message === 'DATABASE_URL is not set') {
        return fail(503, 'No database configured', 'Set DATABASE_URL and run npm run db:migrate.');
      }
      console.error('[api]', message);
      return fail(500, 'Unexpected error');
    }
  };
}

export async function body<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, 'Body must be JSON');
  }
  return schema.parse(raw);
}

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

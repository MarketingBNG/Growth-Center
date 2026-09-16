/**
 * Single place every client mutation goes through, so errors surface as thrown
 * Errors carrying the API's message rather than an unread non-2xx response.
 */
export async function api<T = unknown>(
  path: string,
  init?: RequestInit & { json?: unknown },
): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(path, {
    ...rest,
    headers: { ...(json ? { 'content-type': 'application/json' } : {}), ...rest.headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });

  const text = await res.text();
  const parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};

  if (!res.ok) {
    throw new Error((parsed.error as string) || `Request failed (${res.status})`);
  }
  return parsed as T;
}

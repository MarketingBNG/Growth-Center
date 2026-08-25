import { RANGE_OPTIONS } from './enums.ts';

const ALLOWED = RANGE_OPTIONS.map((o) => o.value) as readonly string[];

/** Validates ?range= against the allow-list so a hand-edited URL cannot ask for an
 *  arbitrary window. Defaults to 30 days. */
export function rangeParam(params: Record<string, string | string[] | undefined>): {
  value: string;
  days: number;
  bucket: 'day' | 'month';
} {
  const raw = typeof params.range === 'string' ? params.range : '';
  const value = ALLOWED.includes(raw) ? raw : '30';
  const days = Number(value);
  return { value, days, bucket: days > 120 ? 'month' : 'day' };
}

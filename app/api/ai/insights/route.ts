import { z } from 'zod';
import { body, route } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import { generateInsights, growthContext } from '@/lib/ai';
import { rateLimit } from '@/lib/rate-limit';
import { RANGE_OPTIONS } from '@/lib/enums';

// The window the page was showing when the button was pressed, off the same list the
// picker offers — not a free number, because this decides what a stored finding is a
// statement about. Absent means 90, which is what this route did before D3.
const DAYS = RANGE_OPTIONS.map((o) => Number(o.value));
const Input = z.object({
  days: z.number().refine((d) => DAYS.includes(d), 'Not a window the range picker offers').optional(),
});

// Generates the findings on the AI Insights page. Manual — nothing calls this on a
// schedule, so the page's insights are as old as the last time somebody asked for them.

export const POST = route('ai:run', async (user, req) => {
  const { days = 90 } = await body(req, Input);
  // Tighter than the Ask box's six a minute: one run rewrites the whole set, so pressing
  // the button repeatedly costs money to produce the same findings over again.
  const limit = rateLimit(`ai:insights:${user.email}`, { perMinute: 2, burst: 3 });
  if (!limit.allowed) {
    throw new HttpError(429, `Just generated — try again in ${limit.retryAfterSeconds}s.`);
  }

  try {
    return await generateInsights(await growthContext(days));
  } catch (e) {
    // 422 rather than 500: a model that returned nothing usable is not a bug in this
    // route, and the message says which of the two it was.
    throw new HttpError(422, (e as Error).message);
  }
});

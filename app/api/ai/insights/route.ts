import { route } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import { generateInsights, growthContext } from '@/lib/ai';
import { rateLimit } from '@/lib/rate-limit';

// Generates the findings on the AI Insights page. Manual — nothing calls this on a
// schedule, so the page's insights are as old as the last time somebody asked for them.

export const POST = route('ai:run', async (user) => {
  // Tighter than the Ask box's six a minute: one run rewrites the whole set, so pressing
  // the button repeatedly costs money to produce the same findings over again.
  const limit = rateLimit(`ai:insights:${user.email}`, { perMinute: 2, burst: 3 });
  if (!limit.allowed) {
    throw new HttpError(429, `Just generated — try again in ${limit.retryAfterSeconds}s.`);
  }

  try {
    return await generateInsights(await growthContext(90));
  } catch (e) {
    // 422 rather than 500: a model that returned nothing usable is not a bug in this
    // route, and the message says which of the two it was.
    throw new HttpError(422, (e as Error).message);
  }
});

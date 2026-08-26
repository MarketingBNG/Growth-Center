import { z } from 'zod';
import { body, route } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import { ask, growthContext } from '@/lib/ai';
import { rateLimit } from '@/lib/rate-limit';

// Every call spends Anthropic tokens, so a signed-in user must not be able to loop it.
// Keyed on the user, not the IP, because the roster is the identity here.
export const POST = route('ai:run', async (user, req) => {
  const limit = rateLimit(`ai:${user.email}`, { perMinute: 6, burst: 10 });
  if (!limit.allowed) {
    throw new HttpError(
      429,
      `Too many questions — try again in ${limit.retryAfterSeconds}s.`,
    );
  }

  const { question, days } = await body(
    req,
    z.object({
      question: z.string().trim().min(3).max(500),
      days: z.number().int().min(7).max(365).default(90),
    }),
  );

  const result = await ask(question, await growthContext(days));
  if (!result.ok) throw new HttpError(422, result.error);
  return { answer: result.answer, model: result.model };
});

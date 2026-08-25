import { z } from 'zod';
import { body, route } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import { ask, growthContext } from '@/lib/ai';

export const POST = route('ai:run', async (_user, req) => {
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

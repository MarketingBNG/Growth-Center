import { z } from 'zod';
import { body, route } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import { authUrlFor, connect } from '@/lib/integrations/service';
import { getProvider } from '@/lib/integrations/registry';
import { IntegrationError } from '@/lib/integrations/types';
import { signState } from '@/lib/oauth-state';

type Ctx = { params: Promise<{ id: string }> };

const input = z.object({
  apiKey: z.string().trim().min(1).max(500).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

export const POST = route<unknown, Ctx>('integrations:manage', async (user, req, ctx) => {
  const { id } = await ctx.params;
  const provider = getProvider(id);
  if (!provider) throw new HttpError(404, `Unknown integration: ${id}`);

  const parsed = await body(req, input);

  try {
    if (provider.authKind === 'oauth2') {
      // The redirect URI must match what is registered with the provider exactly, so it
      // is derived from the request origin rather than configured separately.
      const origin = new URL(req.url).origin;
      const redirectUri = `${origin}/api/integrations/${id}/callback`;
      return { url: authUrlFor(id, redirectUri, signState(id, user.email)) };
    }

    if (!parsed.apiKey) throw new IntegrationError('An API key is required.');
    await connect(id, { kind: 'apiKey', apiKey: parsed.apiKey, config: parsed.config }, user.email);
    return { ok: true };
  } catch (e) {
    if (e instanceof IntegrationError) throw new HttpError(422, e.message);
    throw e;
  }
});

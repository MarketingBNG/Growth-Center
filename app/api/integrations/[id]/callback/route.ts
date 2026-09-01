import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { connect } from '@/lib/integrations/service';
import { getProvider } from '@/lib/integrations/registry';
import { IntegrationError } from '@/lib/integrations/types';
import { verifyState } from '@/lib/oauth-state';
import { can } from '@/lib/roles';
import { TAGS, invalidate } from '@/lib/cache';

// The provider redirects the browser here, so this returns a redirect rather than JSON.

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const back = (params: Record<string, string>) =>
    NextResponse.redirect(new URL(`/integrations?${new URLSearchParams(params)}`, url.origin));

  const user = await currentUser();
  if (!user || !can(user.role, 'integrations:manage')) {
    return back({ error: 'You are not allowed to connect integrations.' });
  }

  const denied = url.searchParams.get('error');
  if (denied) return back({ error: `The provider returned: ${denied}` });

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) return back({ error: 'The provider did not return an authorisation code.' });

  // Signed state, checked before the code is spent: without this, a link could make a
  // signed-in admin connect an account they did not choose.
  if (!verifyState(state, id, user.email)) {
    return back({ error: 'That authorisation request could not be verified. Start again.' });
  }

  const provider = getProvider(id);
  if (!provider) return back({ error: `Unknown integration: ${id}` });

  try {
    const redirectUri = `${url.origin}/api/integrations/${id}/callback`;
    await connect(id, { kind: 'oauth2', code, redirectUri }, user.email);
    await invalidate(TAGS.integrations);
    return back({ connected: provider.name });
  } catch (e) {
    const message = e instanceof IntegrationError ? e.message : 'Connection failed.';
    return back({ error: message });
  }
}

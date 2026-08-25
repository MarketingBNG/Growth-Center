import { NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyApiKey } from '@/lib/apikeys';
import { createLead } from '@/lib/leads';
import { SOURCE_TYPES } from '@/lib/enums';
import { hasDb } from '@/lib/prisma';

// Website form capture. Authenticated by an org API key rather than a session, because
// the caller is a landing page, not a signed-in person.
//
// Deliberately permissive about extra fields and strict about the ones it stores: a
// marketing site should not break because someone added a field to a form.

const input = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().max(80).optional(),
  email: z.string().trim().email().max(200).optional(),
  phone: z.string().trim().max(40).optional(),
  companyName: z.string().trim().max(160).optional(),
  title: z.string().trim().max(120).optional(),
  message: z.string().trim().max(4000).optional(),
  sourceType: z.enum(SOURCE_TYPES).default('form'),
  utmSource: z.string().trim().max(120).optional(),
  utmMedium: z.string().trim().max(120).optional(),
  utmCampaign: z.string().trim().max(160).optional(),
  utmTerm: z.string().trim().max(160).optional(),
  utmContent: z.string().trim().max(160).optional(),
  landingPage: z.string().trim().max(500).optional(),
  referrer: z.string().trim().max(500).optional(),
});

export async function POST(req: Request) {
  if (!hasDb()) {
    return NextResponse.json({ error: 'Not configured' }, { status: 503 });
  }

  const key = await verifyApiKey(req.headers.get('x-api-key'));
  if (!key) {
    return NextResponse.json({ error: 'Invalid or missing X-API-Key' }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 });
  }

  const parsed = input.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', detail: z.treeifyError(parsed.error) },
      { status: 422 },
    );
  }

  const result = await createLead({ ...parsed.data, tags: [] }, null);

  // 200 rather than 201 for a duplicate, and `created` says which happened — a form
  // that resubmits should not look like a failure to the page that posted it.
  return NextResponse.json(
    { id: result.leadId, created: result.created },
    { status: result.created ? 201 : 200 },
  );
}

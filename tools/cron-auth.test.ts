import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cronCheck } from '../lib/platform/cron-check.ts';

// Every /api/cron/* route delegates to lib/platform/cron-auth.ts's cronGuard, which wraps this in
// NextResponse.json — not tested here because next/server does not resolve under bare
// Node (see tools/api.test.ts's comment on the same limitation for lib/platform/api.ts's route()).
// The decision logic is all here, in the module cronGuard itself only wraps.
//
// Fail-closed is the property that matters: an unset secret must refuse, never allow.

function req(authorization?: string): Request {
  return new Request('http://localhost/api/cron/x', {
    headers: authorization ? { authorization } : {},
  });
}

function withEnv(vars: Record<string, string | undefined>, run: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) saved[key] = process.env[key];
  try {
    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    run();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('an unset secret refuses, even with a bearer token guessed right', () => {
  withEnv({ CRON_SECRET: undefined }, () => {
    const result = cronCheck(req('Bearer anything'));
    assert.deepEqual(result, { status: 503, error: 'CRON_SECRET is not set' });
  });
});

test('the wrong bearer token is refused', () => {
  withEnv({ CRON_SECRET: 'right-secret', DATABASE_URL: 'postgres://x' }, () => {
    const result = cronCheck(req('Bearer wrong-secret'));
    assert.deepEqual(result, { status: 401, error: 'Unauthorised' });
  });
});

test('no bearer token at all is refused', () => {
  withEnv({ CRON_SECRET: 'right-secret', DATABASE_URL: 'postgres://x' }, () => {
    const result = cronCheck(req());
    assert.deepEqual(result, { status: 401, error: 'Unauthorised' });
  });
});

test('the right token with no database configured is refused', () => {
  withEnv({ CRON_SECRET: 'right-secret', DATABASE_URL: undefined }, () => {
    const result = cronCheck(req('Bearer right-secret'));
    assert.deepEqual(result, { status: 503, error: 'No database configured' });
  });
});

test('the right token with a database configured is let through', () => {
  withEnv({ CRON_SECRET: 'right-secret', DATABASE_URL: 'postgres://x' }, () => {
    const result = cronCheck(req('Bearer right-secret'));
    assert.equal(result, null);
  });
});

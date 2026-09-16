import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { can, wouldAllow, PERMISSIONS, ROLE_VALUES, type Role } from '../lib/access/roles.ts';

// One way to ask whether to show a control.
//
// Three were in use across six pages. The one that mattered was `can(user?.role ?? 'user',
// …)`: `user` is a real tier holding crm:write and content:write, so the fallback handed
// an unauthenticated caller write controls instead of denying them. It reads like caution
// and does the opposite.

const ROOT = join(import.meta.dirname, '..');

function pages(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) pages(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const files = pages(join(ROOT, 'app')).map((file) => ({
  path: file.slice(ROOT.length + 1).split(sep).join('/'),
  source: readFileSync(file, 'utf8'),
}));

test('no permission check defaults a signed-out visitor into a tier', () => {
  const offenders = files
    .filter((f) => /can\(\s*user\?\.role\s*\?\?/.test(f.source))
    .map((f) => f.path);

  assert.deepEqual(
    offenders,
    [],
    "pass user?.role on its own — can() already denies a missing role, and '?? user' grants a tier that holds crm:write and content:write",
  );
});

test('no permission check re-implements the null case with a ternary', () => {
  const offenders = files
    .filter((f) => /user\s*\?\s*can\(/.test(f.source))
    .map((f) => f.path);

  assert.deepEqual(offenders, [], 'can(user?.role, …) already returns false without a role');
});

test('there are permission checks to find', () => {
  // Otherwise both assertions above pass by finding nothing at all.
  const checked = files.filter((f) => /\bcan\(/.test(f.source));
  assert.ok(checked.length >= 6, `expected several pages to gate a control, found ${checked.length}`);
});

// ── The behaviour the idiom depends on ────────────────────────────────────────────────

test('no role is refused every permission there is', () => {
  for (const permission of PERMISSIONS) {
    assert.equal(can(null, permission), false, `can(null, ${permission}) allowed it`);
    assert.equal(can(undefined, permission), false, `can(undefined, ${permission}) allowed it`);
  }
});

test('the discarded fallback really was more permissive than no role', () => {
  // The point of the change, stated as a fact rather than an argument: there is at least
  // one permission the `user` tier holds, so defaulting to it is a grant.
  const granted = PERMISSIONS.filter((p) => wouldAllow('user', p));
  assert.ok(granted.length > 0, 'user holds no permissions, so the fallback was harmless');
  assert.ok(granted.includes('crm:write'), 'expected user to hold crm:write');
  assert.ok(granted.includes('content:write'), 'expected user to hold content:write');
});

test('every real role is still granted what the policy says', () => {
  // Guards against "fixing" the leniency by making can() deny everything.
  for (const role of ROLE_VALUES as Role[]) {
    for (const permission of PERMISSIONS) {
      assert.equal(
        can(role, permission),
        wouldAllow(role, permission),
        `can(${role}, ${permission}) disagrees with the policy`,
      );
    }
  }
});

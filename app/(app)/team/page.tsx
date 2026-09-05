import { Suspense } from 'react';
import { connection } from 'next/server';
import { PageHeader } from '@/components/patterns/page-header';
import { PageSkeleton } from '@/components/patterns/page-skeleton';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { NoDatabaseState } from '@/components/patterns/state';
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { currentUser } from '@/lib/auth';
import { hasDb } from '@/lib/prisma';
import { ADMIN_EMAILS, ALLOWED_DOMAINS, ROLES_ENFORCED, isAdmin, pinnedName } from '@/lib/roles';
import { fmtRelative } from '@/lib/format';
import { ensureAdmins, listUsers } from '@/lib/users';
import { RoleSelect } from './RoleSelect';
import { TeamActions } from './TeamActions';

export const metadata = { title: 'Team · Growth Center' };

// Access is not an allow-list any more. Anyone with a Google account on an allowed
// domain can sign in, and their row appears here on first arrival. This page exists to
// show who has actually been in, and to switch an account off.
export default function TeamPage() {
  return (
    <>
      <PageHeader
        title="Team"
        subtitle={
          <Suspense fallback="Everyone who has signed in.">
            <TeamSubtitle />
          </Suspense>
        }
      />
      <Suspense fallback={<PageSkeleton headless />}>
        <TeamBody />
      </Suspense>
    </>
  );
}

async function TeamSubtitle() {
  if (!hasDb()) return 'Everyone who has signed in.';
  const active = (await listUsers()).filter((p) => p.active).length;
  return `${active} active ${active === 1 ? 'account' : 'accounts'}. Anyone with a company Google account can sign in — accounts are created on first use.`;
}

async function TeamBody() {
  if (!hasDb()) return <Card><NoDatabaseState /></Card>;

  // Request time, not build time. ensureAdmins() writes rows stamped with the current
  // date, and a prerender has no "now" it is allowed to invent — connection() is how a
  // component says it must wait for a real request.
  await connection();

  // So the admin accounts are on the page from the start, signed in or not.
  await ensureAdmins();
  const [people, me] = await Promise.all([listUsers(), currentUser()]);

  // Said out loud on the page rather than left for somebody to infer from the column: with
  // tiers enforced and every account an Owner, the enforcement is real and invisible, and
  // those two facts together are the thing a reader needs.
  const everyoneIsOwner = people.length > 0 && people.every((p) => p.role === 'owner');

  return (
    <>
      {!ROLES_ENFORCED ? (
        <Card className="mb-4 border-warning/40 bg-warning/5">
          <CardHeader>
            <CardTitle>Everyone has full access</CardTitle>
            <p className="text-[11px] text-muted-foreground">
              Role tiers are switched off: every signed-in person can manage integrations, mint
              API keys and edit any record, whatever role they hold. Roles set here are recorded
              and audited now so they are already correct on the day tiers are switched on in{' '}
              <code className="font-mono">lib/roles.ts</code> — until then, treat the Role column
              as a plan, and revoking access as the only control that bites.
            </p>
          </CardHeader>
        </Card>
      ) : everyoneIsOwner ? (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Role tiers are on, and everyone is an Owner</CardTitle>
            <p className="text-[11px] text-muted-foreground">
              Permissions are enforced from the Role column now, not merely recorded. That
              currently changes nothing, because every account here holds Owner and an Owner
              holds every permission — the tiers begin to bite the moment somebody is made
              Admin or User. An Admin can build and run a campaign and cannot sign it off,
              mint an API key, or change a setting.
            </p>
          </CardHeader>
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Who has signed in</CardTitle>
          <p className="text-[11px] text-muted-foreground">
            Sign-in requires a Google account on {ALLOWED_DOMAINS.join(' or ')}. Revoking takes
            effect on that person&apos;s next request; their existing records stay intact.{' '}
            {ADMIN_EMAILS.length === 1 ? 'The admin account cannot' : 'Admin accounts cannot'} be
            revoked. Google returns some mangled display names, so any name here can be
            corrected.
          </p>
        </CardHeader>
        <TableWrap>
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Email</TH>
                <TH>Role</TH>
                <TH>Status</TH>
                <TH>Last seen</TH>
                <TH>First signed in</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {people.length === 0 ? (
                <TR>
                  <TD colSpan={7} className="py-8 text-center text-muted-foreground">
                    Nobody has signed in yet.
                  </TD>
                </TR>
              ) : (
                people.map((p) => (
                  <TR key={p.email} className={p.active ? undefined : 'opacity-60'}>
                    <TD>
                      <span className="inline-flex items-center gap-2">
                        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-secondary text-[10px] font-semibold">
                          {p.initials}
                        </span>
                        <span className="font-medium">{p.name}</span>
                        {isAdmin(p.email) ? <Badge tone="purple">admin</Badge> : null}
                      </span>
                    </TD>
                    <TD className="font-mono text-xs text-muted-foreground">{p.email}</TD>
                    <TD>
                      <RoleSelect
                        email={p.email}
                        role={p.role}
                        isSelf={p.email === me?.email}
                        isAdmin={isAdmin(p.email)}
                      />
                    </TD>
                    <TD>
                      <Badge tone={p.active ? 'success' : 'neutral'}>
                        {p.active ? 'active' : 'revoked'}
                      </Badge>
                    </TD>
                    <TD className="text-muted-foreground">
                      {p.lastSeenAt ? fmtRelative(p.lastSeenAt) : '—'}
                    </TD>
                    <TD className="text-muted-foreground">{fmtRelative(p.createdAt)}</TD>
                    <TD className="text-right">
                      <TeamActions
                        email={p.email}
                        name={p.name}
                        active={p.active}
                        isSelf={p.email === me?.email}
                        isAdmin={isAdmin(p.email)}
                        namePinned={!!pinnedName(p.email)}
                      />
                    </TD>
                  </TR>
                ))
              )}
            </TBody>
          </Table>
        </TableWrap>
      </Card>
    </>
  );
}

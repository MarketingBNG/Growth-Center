import { PageHeader } from '@/components/patterns/page-header';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { NoDatabaseState } from '@/components/patterns/state';
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { currentUser } from '@/lib/auth';
import { hasDb } from '@/lib/prisma';
import { ALLOWED_DOMAINS, ROLES_ENFORCED } from '@/lib/roles';
import { fmtRelative } from '@/lib/format';
import { listUsers } from '@/lib/users';
import { TeamActions } from './TeamActions';

export const metadata = { title: 'Team · Growth Center' };

// Access is not an allow-list any more. Anyone with a Google account on an allowed
// domain can sign in, and their row appears here on first arrival. This page exists to
// show who has actually been in, and to switch an account off.
export default async function TeamPage() {
  if (!hasDb()) {
    return (
      <>
        <PageHeader title="Team" subtitle="Everyone who has signed in." />
        <Card><NoDatabaseState /></Card>
      </>
    );
  }

  const [people, me] = await Promise.all([listUsers(), currentUser()]);
  const active = people.filter((p) => p.active).length;

  return (
    <>
      <PageHeader
        title="Team"
        subtitle={`${active} active ${active === 1 ? 'account' : 'accounts'}. Anyone with a company Google account can sign in — accounts are created on first use.`}
      />

      {!ROLES_ENFORCED ? (
        <Card className="mb-4 border-warning/40 bg-warning/5">
          <CardHeader>
            <CardTitle>Everyone has full access</CardTitle>
            <p className="text-[11px] text-muted-foreground">
              Role tiers are switched off: every signed-in person can manage integrations, mint
              API keys and edit any record. The <code className="font-mono">role</code> column is
              still recorded, so tiers can be turned back on in{' '}
              <code className="font-mono">lib/roles.ts</code> without losing data. Until then,
              revoking access is the only control on this page.
            </p>
          </CardHeader>
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Who has signed in</CardTitle>
          <p className="text-[11px] text-muted-foreground">
            Sign-in requires a Google account on {ALLOWED_DOMAINS.join(' or ')}. Revoking takes
            effect on that person&apos;s next request; their existing records stay intact.
          </p>
        </CardHeader>
        <TableWrap>
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Email</TH>
                <TH>Status</TH>
                <TH>Last seen</TH>
                <TH>First signed in</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {people.length === 0 ? (
                <TR>
                  <TD colSpan={6} className="py-8 text-center text-muted-foreground">
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
                      </span>
                    </TD>
                    <TD className="font-mono text-xs text-muted-foreground">{p.email}</TD>
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
                        active={p.active}
                        isSelf={p.email === me?.email}
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

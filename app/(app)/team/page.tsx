import { PageHeader } from '@/components/patterns/page-header';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { can, ROSTER, ALLOWED_DOMAINS, type Permission, type Role } from '@/lib/roles';

export const metadata = { title: 'Team · Growth Center' };

const ROLES: Role[] = ['partner', 'controller', 'manager', 'member', 'viewer'];

const PERMISSIONS: { key: Permission; label: string }[] = [
  { key: 'growth:read', label: 'View everything' },
  { key: 'crm:write', label: 'Edit CRM and leads' },
  { key: 'pipeline:write', label: 'Edit pipeline' },
  { key: 'content:write', label: 'Edit content' },
  { key: 'campaigns:write', label: 'Edit campaigns' },
  { key: 'outreach:send', label: 'Send outreach' },
  { key: 'ai:run', label: 'Run AI insights' },
  { key: 'integrations:manage', label: 'Manage integrations' },
  { key: 'apikeys:manage', label: 'Manage API keys' },
  { key: 'settings:manage', label: 'Change settings' },
];

const ROLE_TONE = {
  partner: 'purple',
  controller: 'purple',
  manager: 'info',
  member: 'neutral',
  viewer: 'neutral',
} as const;

// No database: the roster IS lib/roles.ts. That is deliberate — it makes access a code
// change with a reviewable diff rather than a row someone can quietly edit.
export default function TeamPage() {
  return (
    <>
      <PageHeader
        title="Team"
        subtitle={`${ROSTER.length} people can sign in. Access is granted by editing lib/roles.ts, not from this page.`}
      />

      <Card className="mb-4 overflow-hidden">
        <CardHeader>
          <CardTitle>Who has access</CardTitle>
          <p className="text-[11px] text-muted-foreground">
            Sign-in requires a Google account on {ALLOWED_DOMAINS.join(' or ')} that also appears
            below. Removing a line revokes access on that person&apos;s next request.
          </p>
        </CardHeader>
        <TableWrap>
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Email</TH>
                <TH>Role</TH>
                <TH>Title</TH>
                <TH>Team</TH>
              </TR>
            </THead>
            <TBody>
              {ROSTER.map((p) => (
                <TR key={p.email}>
                  <TD>
                    <span className="inline-flex items-center gap-2">
                      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-secondary text-[10px] font-semibold">
                        {p.initials}
                      </span>
                      <span className="font-medium">{p.name}</span>
                    </span>
                  </TD>
                  <TD className="font-mono text-xs text-muted-foreground">{p.email}</TD>
                  <TD><Badge tone={ROLE_TONE[p.role]}>{p.role}</Badge></TD>
                  <TD className="text-muted-foreground">{p.displayRole ?? '—'}</TD>
                  <TD className="text-muted-foreground">{p.team ?? '—'}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>What each role can do</CardTitle>
          <p className="text-[11px] text-muted-foreground">
            Rendered from the same POLICY table the server enforces, so this cannot drift from
            the real permissions.
          </p>
        </CardHeader>
        <TableWrap>
          <Table>
            <THead>
              <TR>
                <TH>Capability</TH>
                {ROLES.map((r) => <TH key={r} className="text-center">{r}</TH>)}
              </TR>
            </THead>
            <TBody>
              {PERMISSIONS.map((p) => (
                <TR key={p.key}>
                  <TD>
                    <span className="font-medium">{p.label}</span>
                    <p className="font-mono text-[10px] text-muted-foreground">{p.key}</p>
                  </TD>
                  {ROLES.map((r) => (
                    <TD key={r} className="text-center">
                      {can(r, p.key) ? (
                        <span className="text-success">✓</span>
                      ) : (
                        <span className="text-muted-foreground/40">—</span>
                      )}
                    </TD>
                  ))}
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      </Card>
    </>
  );
}

import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/patterns/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { currentUser } from '@/lib/auth';
import { can } from '@/lib/roles';
import { hasDb } from '@/lib/prisma';
import { GLOSSARY, disagreementCount, type GlossaryAgreement } from '@/lib/glossary';
import { glossaryOwners } from '@/lib/settings';
import { GlossaryOwner } from './GlossaryOwner';

export const metadata = { title: 'Glossary · Growth Center' };

/**
 * Appendix C, written against the code rather than copied from the manual.
 *
 * Two of the thirteen entries agree with the manual, and they are the least interesting
 * thing on the page. What earns it its place is the other eleven: a "Qualified lead" this
 * CRM cannot identify, a "New business" the manual would read from a field that does not
 * exist, an
 * "Attribution health" whose definition would report 0% for ever, and a "Quality score"
 * whose column is present and zero on every row.
 *
 * Ordered as the manual orders it — lifecycle first, then the measures, then the insight
 * vocabulary — rather than grouped by whether the code agrees. Somebody arrives here
 * looking up one word, and the manual's order is the order they know.
 */
const TONE: Record<GlossaryAgreement, { tone: 'success' | 'warning' | 'neutral'; label: string }> = {
  agrees: { tone: 'success', label: 'As written' },
  differs: { tone: 'warning', label: 'Differs' },
  'not-computed': { tone: 'neutral', label: 'Not computed' },
};

export default async function GlossaryPage() {
  const user = await currentUser();
  if (!user) redirect('/signin');

  const canEdit = can(user.role, 'settings:manage');
  const owners = hasDb() ? await glossaryOwners() : {};
  const differing = disagreementCount();

  return (
    <>
      <PageHeader
        title="Glossary"
        subtitle="What each word means in this application, and who decides. Where the code and the manual disagree, both are shown."
      />

      <Card className="mb-[18px]">
        <CardHeader>
          <CardTitle>
            {differing} of {GLOSSARY.length} terms do not mean what the manual says
          </CardTitle>
          {/* Said plainly, because the instinct on reading it is to treat every difference
              as a defect. Most of them are not: they are this CRM being described
              accurately instead of in the vocabulary the manual assumed. */}
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            A difference is not automatically a defect. Most of these are the code being
            right about this CRM — there is no <code>Deal_Type</code> field, and{' '}
            <code>qualifiedAt</code> is stamped on conversion. Three are real gaps and say
            so. The value of the list is that a word used in a meeting means one thing.
          </p>
        </CardHeader>
      </Card>

      <div className="space-y-3">
        {GLOSSARY.map((term) => {
          const owner = owners[term.slug] ?? term.defaultOwner;
          const isDefault = !owners[term.slug];
          const badge = TONE[term.agreement];

          return (
            <Card key={term.slug} id={term.slug}>
              <CardHeader className="gap-2.5">
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <CardTitle>{term.term}</CardTitle>
                    <Badge tone={badge.tone}>{badge.label}</Badge>
                  </div>
                  {canEdit ? (
                    <GlossaryOwner slug={term.slug} owner={owner} isDefault={isDefault} />
                  ) : (
                    <div className="flex flex-col items-end gap-0.5">
                      <span className="text-xs font-medium">{owner}</span>
                      <span className="text-[11px] text-muted-foreground/70">
                        owns this definition
                      </span>
                    </div>
                  )}
                </div>
              </CardHeader>

              <CardContent className="space-y-2.5 pt-0">
                <p className="text-[13px] leading-relaxed">{term.definition}</p>

                {/* The manual's wording is shown only where it differs. Repeating it under
                    every entry that agrees would be the second copy of a document this
                    page exists to avoid. */}
                {term.agreement !== 'agrees' ? (
                  <div className="rounded-md border-l-2 border-warning-soft bg-track/60 px-3 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      The manual says
                    </p>
                    <p className="mt-0.5 text-xs italic leading-relaxed text-muted-foreground">
                      “{term.manual}”
                    </p>
                    {term.note ? (
                      <p className="mt-1.5 text-xs leading-relaxed">{term.note}</p>
                    ) : null}
                  </div>
                ) : null}

                {term.where ? (
                  <p className="text-[11px] text-muted-foreground/70">
                    Computed in <code>{term.where}</code>
                  </p>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}

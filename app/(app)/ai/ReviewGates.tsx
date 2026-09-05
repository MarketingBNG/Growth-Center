import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { ProgressLink } from '@/components/NavProgress';
import { campaignsMissingRegistry, canScale } from '@/lib/review-card';

// §21.3 and §21.4, on the screen where the proposals are.
//
// The manual says of one of these rules: "this is the plan's own rule and the app
// enforces it." Enforcement that nobody can see before they act is a refusal at the last
// moment, so the two standing gates are stated here — what may not be approved today, and
// why — rather than only firing when somebody presses a button.

export async function ReviewGates() {
  const [scale, unregistered] = await Promise.all([canScale(), campaignsMissingRegistry()]);

  // Nothing to say when both gates are open. A panel that reports "all clear" every day
  // is a panel people stop reading, and these are refusals rather than metrics.
  if (scale.allowed && unregistered.length === 0) return null;

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>What cannot be approved today</CardTitle>
        <p className="text-xs text-muted-foreground">
          §21.4. These are refusals, not warnings — the app applies them whether or not this
          panel is open.
        </p>
      </CardHeader>
      <ul className="divide-y divide-border border-t border-border text-xs">
        {!scale.allowed ? (
          <li className="px-4 py-2.5">
            <p className="font-medium">No scale decision on any channel</p>
            <p className="mt-0.5 text-muted-foreground">{scale.reason}</p>
          </li>
        ) : null}
        {unregistered.length > 0 ? (
          <li className="px-4 py-2.5">
            <p className="font-medium">
              {unregistered.length} active campaign{unregistered.length === 1 ? '' : 's'} without a
              complete registry row
            </p>
            <p className="mt-0.5 text-muted-foreground">
              §21.4: no campaign may be approved without a row naming its objective, segment,
              service line and landing page. The sync fills the objective; the landing page is
              entered by hand.
            </p>
            <ul className="mt-1.5 space-y-0.5">
              {unregistered.slice(0, 6).map((c) => (
                <li key={c.id} className="text-muted-foreground">
                  <span className="text-foreground">{c.name}</span> — missing {c.missing.join(' and ')}
                </li>
              ))}
            </ul>
            {unregistered.length > 6 ? (
              <p className="mt-1 text-muted-foreground">…and {unregistered.length - 6} more.</p>
            ) : null}
            <ProgressLink href="/marketing" className="mt-1.5 inline-block text-primary hover:underline">
              Open Marketing
            </ProgressLink>
          </li>
        ) : null}
      </ul>
    </Card>
  );
}

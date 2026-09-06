import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { ProgressLink } from '@/components/NavProgress';
import {
  campaignsMissingRegistry,
  canScale,
  sequencesBreachingSuppression,
} from '@/lib/review-card';

// §21.3 and §21.4, on the screen where the proposals are.
//
// The manual says of one of these rules: "this is the plan's own rule and the app
// enforces it." Enforcement that nobody can see before they act is a refusal at the last
// moment, so the two standing gates are stated here — what may not be approved today, and
// why — rather than only firing when somebody presses a button.

export async function ReviewGates() {
  const [scale, unregistered, breaching] = await Promise.all([
    canScale(),
    campaignsMissingRegistry(),
    sequencesBreachingSuppression(),
  ]);

  // Nothing to say when every gate is open. A panel that reports "all clear" every day is
  // a panel people stop reading, and these are refusals rather than metrics.
  if (scale.allowed && unregistered.length === 0 && breaching.length === 0) return null;

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
        {breaching.length > 0 ? (
          <li className="px-4 py-2.5">
            <p className="font-medium">
              No send from {breaching.length} sequence{breaching.length === 1 ? '' : 's'} carrying
              people the firm already knows
            </p>
            <p className="mt-0.5 text-muted-foreground">
              §12.5: a cold list must pass the suppression check against clients and referral
              partners. A client receiving a cold pitch is a relationship event, and the person
              who notices is the client. Signing one of these off is refused until they are
              removed — or until the sequence says it is meant for clients.
            </p>
            <ul className="mt-1.5 space-y-0.5">
              {breaching.slice(0, 6).map((s) => (
                <li key={s.id} className="text-muted-foreground">
                  <span className="text-foreground">{s.name}</span> — {s.suppressed} suppressed
                  recipient{s.suppressed === 1 ? '' : 's'} ({s.status})
                </li>
              ))}
            </ul>
            {breaching.length > 6 ? (
              <p className="mt-1 text-muted-foreground">…and {breaching.length - 6} more.</p>
            ) : null}
            <ProgressLink href="/outreach" className="mt-1.5 inline-block text-primary hover:underline">
              Open Outreach
            </ProgressLink>
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

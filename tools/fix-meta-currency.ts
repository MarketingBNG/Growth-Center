// One-off repair: relabel Meta Ads spend as INR.
//
// The billing-currency lookup in lib/integrations/providers/meta-ads.ts used to fall back
// to 'USD' on any failure. It failed, so 221 days of rupee spend and 12 campaign budgets
// were stored as dollars. The workspace reports in INR, so every one of those figures was
// then multiplied by the exchange rate on the way to the screen: ₹498,116 of real spend
// rendered as ₹40,391,906.
//
// The fallback is gone — a sync now stops rather than guessing — but the rows already
// written still carry the wrong label. This corrects them. It changes no amount, only the
// currency the amount is stated in.
//
// Run:  node --experimental-strip-types --env-file-if-exists=.env.local tools/fix-meta-currency.ts          (dry run)
//       node --experimental-strip-types --env-file-if-exists=.env.local tools/fix-meta-currency.ts --apply  (writes)
//
// Safe to re-run: it only touches rows still labelled USD, so a second run is a no-op.

import { apply, connect, stopUnlessApplying, transact } from './script.ts';

const client = await connect();

const show = async (label: string) => {
  const spend = await client.query(
    `select s.currency, count(*)::int n, sum(s.amount)::float total
       from marketing_spend s join campaign c on c.id = s."campaignId"
      where c.source = 'meta_ads' group by 1 order by 1`,
  );
  const campaigns = await client.query(
    `select currency, count(*)::int n from campaign where source = 'meta_ads' group by 1 order by 1`,
  );
  console.log(`${label} spend:`, spend.rows);
  console.log(`${label} campaigns:`, campaigns.rows);
};

await show('before');

if (!apply) {
  const { rows } = await client.query(
    `select count(*)::int n from marketing_spend s join campaign c on c.id = s."campaignId"
      where c.source = 'meta_ads' and s.currency = 'USD'`,
  );
  await stopUnlessApplying(
    client,
    `\nDry run. ${rows[0].n} spend rows would be relabelled USD -> INR.\n` +
      'Re-run with --apply to write.',
  );
}

// Both tables in one transaction: a spend row and the campaign it hangs off must never
// disagree about the currency, which is what budget pacing divides one by the other for.
const [spend, campaigns] = await transact(client, async () => {
  const s = await client.query(
    `update marketing_spend s set currency = 'INR'
       from campaign c
      where c.id = s."campaignId" and c.source = 'meta_ads' and s.currency = 'USD'`,
  );
  const c = await client.query(
    `update campaign set currency = 'INR' where source = 'meta_ads' and currency = 'USD'`,
  );
  return [s, c] as const;
});
console.log(`\nRelabelled ${spend.rowCount} spend rows and ${campaigns.rowCount} campaigns.`);

await show('after');
await client.end();

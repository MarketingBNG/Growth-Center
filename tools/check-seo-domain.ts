// D1 — which domain do the SEO jobs actually read?
//
// Manual v3.0 reports every SEO and PageSpeed insight citing "usaindiancfo.com", an extra
// "n". No such string exists in the tree: the property is whatever was typed into the
// Integration Center, which lives in the database. So this prints the stored config, and
// the hosts the data itself carries, and the question is settled from the live row rather
// than from a screenshot. Read-only.
//
// Run:  node --experimental-strip-types --env-file-if-exists=.env.local tools/check-seo-domain.ts
import pg from 'pg';

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const providers = await client.query<{
  provider: string; state: string; config: unknown; lastSyncAt: Date | null; lastSyncRows: number | null;
}>(
  `select provider, state::text, config, "lastSyncAt", "lastSyncRows"
     from integration
    where provider in ('google_search_console', 'pagespeed', 'google_analytics')
    order by provider`,
);

console.log('-- integration config --');
if (providers.rowCount === 0) console.log('(no rows for the SEO providers)');
for (const r of providers.rows) {
  const when = r.lastSyncAt ? r.lastSyncAt.toISOString() : 'never';
  console.log(`${r.provider}  ${r.state}  ${JSON.stringify(r.config)}  lastSync=${when} rows=${r.lastSyncRows ?? 0}`);
}

console.log('\n-- websites --');
const sites = await client.query<{ domain: string; pages: string }>(
  `select w.domain, count(p.id)::text as pages
     from website w left join seo_page p on p."websiteId" = w.id
    group by w.domain order by w.domain`,
);
for (const s of sites.rows) console.log(`${s.domain}  ${s.pages} pages`);

// The decisive evidence: PageSpeed measures whatever seo_page rows Search Console produced,
// so a wrong property shows up as a wrong host here.
console.log('\n-- hosts across seo_page --');
const hosts = new Map<string, number>();
for (const p of (await client.query<{ url: string }>('select url from seo_page')).rows) {
  let host = p.url;
  try { host = new URL(p.url).host; } catch { /* stored as a path, keep it whole */ }
  hosts.set(host, (hosts.get(host) ?? 0) + 1);
}
for (const [host, n] of [...hosts].sort((a, b) => b[1] - a[1])) console.log(`${host}  ${n}`);

await client.end();

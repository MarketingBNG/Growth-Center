# Gap report — Growth Center vs the Organic Growth Automation Engine pack

**Written 19 September 2026.** Read-only audit: what the pack's 17 work packages assume,
against what this repository already contains. Nothing here was changed to produce it.

The pack (`Growth_Center_Claude_Code_Pack/`, kept out of git) is the brief. This is the
correction to it. Where the two disagree, this file is the one describing reality.

---

## The headline

**The pack assumes a greenfield Python/FastAPI service called `bng-growth-engine`, with a
fresh PostgreSQL schema. That is the wrong starting point for this repo.**

Growth Center is a Next.js application with 38 Prisma models, 13 integration providers, a
sync framework with cursors, leases, chaining and health reporting, an audit log, RBAC, an
insights rules engine and a reporting layer. Roughly half of what the pack describes as
"to build" is built, in TypeScript, and working against live data.

Building the pack's service as specified would mean a second system reading the same
vendors into a second database. **The recommendation is to extend `lib/integrations/`
instead.** A new provider there is one file plus one line in `registry.ts`, and it inherits
scheduling, cursors, error reporting and the Integration Center UI for free.

What the pack is genuinely right about, and what this repo does not have, is the
**content-production half**: a verified facts register, citation verification, a draft
state machine, and a publishing path with human authorisation. None of that exists.

---

## Package by package

Legend: **Built** · **Partial** · **Missing** · **Blocked** (needs a purchase or a key)

| # | Package | State | Notes |
|---|---|---|---|
| 01 | Core service foundation | **Built, differently** | `lib/integrations/{driver,service,persist,registry,types}.ts`. Not Python. Do not rebuild. |
| 02 | Database schema | **Partial** | 38 models cover CRM, pipeline, metrics, SEO, social, content, outreach, audit. The engine-specific tables — facts, claims, drafts, source packs, refresh candidates — do not exist. |
| 03 | Integration framework + health | **Built** | `SyncRun`, `lib/platform/sync-health.ts`, Integration Center, nightly cron at 01:30, ten-minute sync lease, `ownSchedule` opt-out. |
| 04 | First-party: GSC, GA4, CrUX, Bing | **Mostly built** | See below. |
| 05 | Attribution | **Partial** | `POST /api/public/v1/leads` already accepts website forms with full UTM, landing page and referrer, API-key authenticated and rate-limited. `lib/reports/attribution.ts` exists. Missing: WATI and booking-tool webhooks, and writing source data back to Zoho. |
| 06 | SEO intelligence (SE Ranking, Ahrefs, SERPHouse) | **Blocked** | Nothing purchased. |
| 07 | Fireflies buyer language | **Missing / blocked** | No API key. |
| 08 | Opportunity engine | **Partial** | `lib/insights/insight-rules.ts` is a working rules engine with a review lifecycle (`AiInsight`, proposed/reviewed/dismissed). It scores business findings, not content topics. The revenue-weighted topic scoring is missing, but the queue and review UI it would feed already exist. |
| 09 | Facts register + CA/CPA review centre | **Missing** | The most important gap. `lib/content/content-approval.ts` has an approval flow for content, but there is no facts table, no placeholder mechanism, no numeric-token gate. Every non-negotiable in the pack's §3.1 is unimplemented. |
| 10 | Content factory | **Partial** | `lib/content/content-autofill.ts` and `lib/ai/ai.ts` exist; `ContentPiece` has the pipeline statuses. No research → draft → Surfer → humanise chain, no source packs. |
| 11 | Validators + quality console | **Partial** | `lib/ai/eval-checks.ts` and `lib/ai/narration-check.ts` are real validators with tests. They check AI narration against evidence, not citations against a stored source pack. The pattern to extend is there. |
| 12 | Website content API + publishing | **Missing** | No publish path at all. `notifyIndexNow()` (the announce half) now exists and is waiting for a caller. |
| 13 | Technical SEO + site health | **Partial** | PageSpeed/Lighthouse provider is live and thorough (50 pages measured, CrUX field data handled correctly including the `origin_fallback` trap). Missing: Screaming Frog import, uptime, Clarity. |
| 14 | Revenue, KPI, executive dashboard | **Built** | Dashboard, `lib/metrics/kpis.ts`, `lib/reports/executive.ts`, weekly packs, PDF export. |
| 15 | Authority & distribution | **Blocked** | Needs Ahrefs. |
| 16 | RBAC, hardening, go-live | **Mostly built** | `lib/access/roles.ts` with enforced tiered permissions, append-only `AuditEvent`, sealed credentials, API keys, rate limiting. A go-live pass is worth doing; the mechanisms exist. |
| 17 | Phase 2/3 add-ons | **N/A** | Semrush is permanently closed — 0 API units, not on Business. Do not re-add. |

---

## WP04 in detail, since it is the one that moved

Shipped 19 September 2026 (`14a5ebd`, `5b97d79`, `3556f3a`, `7fc23c6`, `bc1600c`, `359671c`):

- **US/India and device split** — six extra Search Console queries, stored under their own
  entity types. Live and populated.
- **Decay detector** — clicks fall and position slip, thresholds in Settings, 16 tests.
  Feeds a card on /seo. It does **not** yet create a `refresh_candidate` record, because
  the Opportunity Engine table it would feed (WP08) does not exist.
- **IndexNow** — built, audit-logged, inert until the key file is on usaindiacfo.com.
- **AI performance CSV import** — built, with an upload on /seo.

Still open in WP04:

- **Bing Webmaster (task 4)** — blocked on an API key.
- **URL Inspection API (task 1)** — not built. Needs a daily quota figure confirmed
  against current docs before it is worth writing.
- **CrUX weekly (task 3)** — effectively covered by the PageSpeed provider, which already
  stores field data and handles the origin-fallback trap properly. Do not rebuild it;
  if a weekly cadence is wanted, that is a cron entry, not a provider.

---

## What the first run of the split found

Worth recording, because it is the argument for the rest of the SEO work:

| Market | Clicks | Impressions | CTR |
|---|---|---|---|
| India | 549 | 19,523 | 2.81% |
| United States | 66 | 13,226 | 0.50% |

The US is 40% of impressions and 11% of clicks. The cause is **not** titles: those pages
rank 30–75, which is page 4 to 8 of Google. Only the homepage (12.9) and
`/gst-vs-us-sales-tax-guide-for-indian-founders/` (10.3) are near page one. The buried
pages — ERISA, multistate nexus, Form D, FATCA, PFIC — are high-intent US topics with no
authority behind them, which is an Ahrefs-and-links problem (WP15), not a content one.

---

## Recommended order, corrected

1. **WP09 facts register.** The largest genuine gap and the thing every content
   non-negotiable depends on. Needs no purchase — it needs two named CA/CPA reviewers.
2. **WP12 publishing path.** IndexNow is already waiting for it.
3. **WP05 remainder** — WATI and booking webhooks. The hard part (form intake with UTM)
   is done.
4. **WP08 topic scoring**, reusing the existing insight queue rather than a new one.
5. Everything else is blocked on a purchase.

Packages 01, 03 and 14 should be marked complete and not re-run.

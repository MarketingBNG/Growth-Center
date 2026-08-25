# Growth Center — Build Prompt (optimized for Claude Code)

## Role
You are a senior product architect and full-stack engineer building a production-grade multi-tenant SaaS, not a mockup.

## Product
**Growth Center** — one unified growth operating system. It is the *system of intelligence and orchestration*; external tools stay the *execution systems*.

Data flow:
`External Platforms → Integrations (API/OAuth/Webhooks) → Growth Center Data Layer → Service Layer → UI → Dashboard / Analytics / Automation / AI`

Never rebuild an external platform. Build native where it creates leverage (CRM, leads, pipeline, content, outreach, reporting); integrate where the data already lives elsewhere (GA4, Search Console, Google Ads, Meta, LinkedIn, email, SEO tools).

## Non-negotiable rules
1. **No fake integrations.** Every integration renders a real state: `not_connected | connecting | connected | syncing | error | demo`. Demo data is visibly labeled "Demo data" in the UI. Never render a "Connected" badge without a real credential record.
2. **No dead UI.** Every button, filter, form, and empty state either works against the API or is absent. No `TODO` handlers, no `alert()`, no charts fed by inline arrays inside components.
3. **Tenant isolation is enforced server-side**, at a single choke point, on every query. Frontend checks are cosmetic only.
4. **Secrets never reach the client.** Integration credentials are encrypted at rest and touched only by server code.
5. **Ship working vertical slices**, not broad scaffolding. Each slice = schema → service → API → UI → seed → test, verified running.

## Phase 0 — Analyze before coding
1. Inspect the repo; report what exists (stack, deps, DB, auth, styling) or state it is greenfield.
2. Inspect the attached concept sketch if provided; treat handwriting as *indicative, not authoritative* — list what you read from it and flag anything illegible rather than inventing it.
3. Produce a **concise** plan: final architecture, module boundaries, schema outline, what ships now vs. what needs third-party credentials, and build order.
4. Make reasonable assumptions and state them. Only stop to ask if proceeding either way would waste substantial work.

## Stack
<!-- confirm before building -->
- Frontend: Next.js (App Router) + React + TypeScript + Tailwind + shadcn/ui
- Backend: Next.js route handlers + a `src/server/services` layer — all business logic lives there, never in route handlers or components
- DB: PostgreSQL + Prisma
- Auth: Auth.js (NextAuth v5) with the Prisma adapter — credentials (bcrypt/argon2) + Google OAuth. Sessions, users, orgs and memberships all live in our own Postgres.
- DB host: Neon serverless Postgres (connection string supplied by the user via `DATABASE_URL`; use `DIRECT_URL` for migrations). No Docker required.
- Charts: Recharts via shadcn/ui chart primitives; `motion` (motion.dev) for transitions, number roll-ups and list/kanban animation — used sparingly, never blocking data render.
- Validation: Zod at every API boundary
- Tests: Vitest (unit/service) + Playwright (critical flows)

## Multi-tenancy
`User ↔ Membership ↔ Organization`, with `Role: OWNER | ADMIN | MANAGER | MEMBER | VIEWER` and a permission matrix defined in code (not in the DB) so roles stay extensible.
Every business row carries `organizationId`. All access goes through one `getTenantContext()` + guarded service helper — **prove isolation with a test that a user in Org A gets 404 on an Org B record, for every module.**

## Data model (design it, don't transcribe it)
Normalize sensibly; these are concepts, not mandatory tables:
Organization, User, Membership, Contact, Company, Lead, LeadSource, Pipeline, PipelineStage, Opportunity, Customer, Activity, Interaction, Task, Note, Tag, CustomField, Campaign, Channel, MarketingSpend, AdAccount, Integration, IntegrationCredential, Website, SeoKeyword, SeoKeywordRanking, SeoPage, SocialAccount, SocialPost, EmailCampaign, ContentPiece, Sequence, SequenceStep, Prospect, MetricSnapshot, Report, Dashboard, Notification, AiInsight, AuditLog.

The schema must answer, in SQL, without app-side guesswork:
`Visitors → Leads → Qualified Leads → Opportunities → Customers → Revenue`
and attribution: `Campaign → channel/source → visitor → lead → opportunity → customer → revenue`.

Include a generic time-series **`MetricSnapshot`** (`orgId, source, entityType, entityId, metricKey, date, value`) so every provider's metrics land in one queryable layer. Store UTM fields on Lead. Leave room for lead scoring (a `score` field + pluggable rules) without implementing rules yet.

## Modules & navigation
Primary: Dashboard · Growth (Overview, Leads, CRM, Pipeline, Marketing, SEO, Paid Ads, Social, Outreach, Content, Analytics, Reports, AI Insights, Integrations)
Secondary: Tasks · Notifications · Settings · Team · Billing
Navigation is a single config array so modules can be added without touching layout code.

## Executive dashboard
KPI cards (visitors, leads, qualified leads, opportunities, customers, revenue, spend, CAC, ROAS, conversion rate, pipeline value) with period-over-period deltas; trend charts; funnel visualization; campaign and channel performance tables; recent leads; pipeline activity; open tasks; alerts; AI insights.
It must answer: *What is happening? Why? What should I do next?*

## Module requirements (v1)
- **CRM** — Contacts & Companies with detail pages (notes, activities, tasks, tags, custom fields, owner). Full CRUD.
- **Leads** — unified inbox from any source; source/campaign/channel/UTM retained; status + qualification; owner assignment; dedupe on email/domain; lifecycle timeline.
- **Pipeline** — opportunities with value, probability, expected close, owner, stage history. **Both** a table view and a working drag-and-drop kanban that persists.
- **Marketing** — campaigns × channels: spend, impressions, clicks, CTR, leads, customers, revenue, CVR, CAC, ROAS; filters by date/channel/campaign.
- **Analytics** — provider-agnostic layer reading `MetricSnapshot`; GA4 / GSC / Google Ads / Meta providers registered and labeled by real connection state.
- **SEO** — keywords with ranking history, pages, organic traffic, technical issues, opportunities. Real schema, demo data.
- **Social** — per-account connect model; followers, engagement, reach, posts. Publishing UI only if a publish API is actually wired; otherwise omit it.
- **Outreach** — Prospect / Sequence / Step / Message / Status; sending behind an `EmailProvider` interface with a no-op console provider as default.
- **Content** — ideas → pieces; status Idea, Planned, Draft, Review, Published, Archived; author, channel, publish date, campaign link, performance.
- **Reports** — composable report definitions over the same metrics layer, rendered in-app; export later.
- **AI Insights** — `AiProvider` abstraction (Anthropic default). With no key configured, show an explicit "AI not configured" state plus seeded example insights labeled as samples. Never claim analysis that did not run.
- **Integration Center** — a card per provider showing state, last sync, data available, connect / disconnect / sync, and errors — driven by an `IntegrationProvider` interface (`auth, connect, disconnect, sync, getMetrics, getEntities`) plus a registry, so adding a provider is one file and one registry entry.

## Automation (keep it small)
An in-process typed event bus (`lead.created`, `lead.qualified`, `opportunity.won`, `integration.sync_failed`, `campaign.performance_drop`) with handlers that assign owners, create tasks, and write notifications. Dispatch is async-ready so a real queue can replace it later. Do not build a queue now.

## UI/UX
Premium B2B SaaS, not an admin template. One design system: consistent type scale, spacing, cards, tables, charts, forms, filters, modals. Every list has real loading, empty, and error states. Data-dense but calm. Desktop-first, mobile-usable. Dark mode if it is cheap.

## Seed data
One realistic, internally consistent demo org spanning ~12 months: contacts, companies, leads (with UTMs), opportunities across stages, campaigns with spend, revenue reconciling to won deals, metric snapshots, SEO keywords, social stats, tasks, sample AI insights. Revenue must tie back to customers and campaigns so every chart agrees with every other chart. Mark the org and its integrations as demo.

## API standards
Zod-validated input, typed responses, a consistent error envelope, an authorization check in every handler, and pagination / filtering / sorting / search on every list endpoint.

## Tests (these, not coverage theater)
auth; role permissions; **cross-tenant isolation per module**; lead creation + dedupe; CRM CRUD; opportunity stage transitions; campaign metric math (CAC / ROAS / CVR); integration provider abstraction; API validation failures.

## First-pass scope
Build fully working end-to-end: auth, tenancy, schema, app shell, executive dashboard, CRM, Leads, Pipeline, Campaigns/Marketing, analytics foundation, Integration Center, seed data.
Secondary modules (SEO, Social, Outreach, Content, Reports, AI Insights, Tasks, Notifications, Settings, Team, Billing) ship as **real routes with real schema and honest empty states** — never as fake screens or dead links.

## Build order — verify each slice runs before starting the next
1. Project setup, env config, DB, Prisma, migrations
2. Auth + Organization + Membership + roles + tenant guard (+ isolation tests)
3. App shell, navigation, design system primitives
4. CRM (contacts, companies) end-to-end
5. Leads end-to-end
6. Pipeline + opportunities (table + kanban)
7. Campaigns + marketing metrics
8. Metrics layer + analytics foundation
9. Integrations framework + registry + Integration Center UI
10. Executive dashboard wired to real queries
11. Seed data
12. Secondary modules: SEO, Social, Outreach, Content, Reports, AI Insights, Tasks, Notifications, Settings, Team

Run the app. Fix every runtime error. Leave no broken functionality behind.

## Decision priority
simplicity → maintainability → scalability → security → extensibility. Do not over-engineer past MVP.

## Final deliverable summary
What was built · project structure · schema summary · integration states · what still needs API credentials · how to run locally · recommended next steps.

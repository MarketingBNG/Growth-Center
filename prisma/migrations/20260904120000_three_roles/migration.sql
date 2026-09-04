-- Five role tiers become three: owner, admin, user.
--
-- Hand-written rather than generated. Prisma's own diff for an enum whose values all
-- change is a drop and recreate, which would take the column with it; this maps the
-- existing rows across instead.
--
-- The mapping preserves what each old tier could do:
--   partner, controller -> owner   (both held settings and API keys)
--   manager             -> admin   (campaigns, outreach, integrations; no settings)
--   member, viewer      -> user    (records and content)
--
-- On this workspace the question is close to moot: app_user held exactly three rows at
-- the time of writing, all of them 'partner', and all three are the admin mailboxes in
-- lib/roles.ts — so all three land on owner, which is where they belong. The full
-- mapping is here for any environment that is not this one.
--
-- The default changes from partner to user. It was never a decision anyone made — the
-- column has had no writer until now, so every row carries it — and a default that
-- grants everything is the wrong way round once tiers are switched on.

CREATE TYPE "Role_new" AS ENUM ('owner', 'admin', 'user');

ALTER TABLE "app_user" ALTER COLUMN "role" DROP DEFAULT;

ALTER TABLE "app_user"
  ALTER COLUMN "role" TYPE "Role_new"
  USING (
    CASE "role"::text
      WHEN 'partner'    THEN 'owner'
      WHEN 'controller' THEN 'owner'
      WHEN 'manager'    THEN 'admin'
      WHEN 'member'     THEN 'user'
      WHEN 'viewer'     THEN 'user'
      ELSE 'user'
    END
  )::"Role_new";

ALTER TABLE "app_user" ALTER COLUMN "role" SET DEFAULT 'user';

DROP TYPE "Role";

ALTER TYPE "Role_new" RENAME TO "Role";

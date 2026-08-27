-- Instagram saves get their own column. They were being written into `shares`, which
-- both inflated Instagram's engagement against Facebook's and named an action nobody
-- took: Instagram reports no share count for organic media at all. Additive with a
-- default, so existing rows read as "none reported" — which is what they are.
ALTER TABLE "social_post" ADD COLUMN "saves" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "pgp_plans" ALTER COLUMN "template_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pgp_plans" ADD COLUMN "year" integer;--> statement-breakpoint
ALTER TABLE "pgp_plans" ADD COLUMN "quarter" integer;--> statement-breakpoint
ALTER TABLE "pgp_plans" ADD COLUMN "source_ref" text;--> statement-breakpoint
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(DISTINCT t.period, ', ') INTO bad
    FROM pgp_plans p JOIN pgp_templates t ON t.id = p.template_id
   WHERE t.period !~ '^20[0-9]{2}-Q[1-4]$';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot backfill plan period: template period(s) not in YYYY-Qn format: %. Fix pgp_templates.period and rerun.', bad;
  END IF;
END $$;--> statement-breakpoint
UPDATE "pgp_plans" p SET "year" = substr(t.period, 1, 4)::int, "quarter" = substr(t.period, 7, 1)::int
  FROM "pgp_templates" t WHERE t.id = p.template_id;--> statement-breakpoint
DO $$
DECLARE dup text;
BEGIN
  SELECT string_agg(user_id::text || ' ' || year || '-Q' || quarter, '; ') INTO dup FROM (
    SELECT user_id, year, quarter FROM pgp_plans GROUP BY 1, 2, 3 HAVING count(*) > 1
  ) d;
  IF dup IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot enforce one plan per user per quarter; duplicates (user_id period): %. Remove or merge them and rerun.', dup;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "pgp_plans" ALTER COLUMN "year" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "pgp_plans" ALTER COLUMN "quarter" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "pgp_plans" ADD CONSTRAINT "pgp_plans_quarter_chk" CHECK ("quarter" BETWEEN 1 AND 4);--> statement-breakpoint
CREATE UNIQUE INDEX "plans_user_period_uq" ON "pgp_plans" USING btree ("user_id","year","quarter");

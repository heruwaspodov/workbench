CREATE TABLE "initiative_milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"initiative_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"date" date NOT NULL,
	"label" text,
	CONSTRAINT "initiative_milestones_kind_chk" CHECK ("initiative_milestones"."kind" in ('release', 'self_test'))
);
--> statement-breakpoint
CREATE TABLE "initiatives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"year" integer NOT NULL,
	"quarter" integer NOT NULL,
	"source_ref" text,
	"jira_key" text NOT NULL,
	"squad" text,
	"title" text NOT NULL,
	"criticality" text,
	"epic_status" text DEFAULT 'To Do' NOT NULL,
	"project_status" text,
	"owner_name" text,
	"est_delivery_date" date,
	"actual_delivery_date" date,
	"done_items" integer,
	"total_items" integer,
	"prd_url" text,
	"rfc_url" text,
	"remark" text,
	"remark_proposed" text,
	"needs_review" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "initiatives_quarter_chk" CHECK ("initiatives"."quarter" between 1 and 4),
	CONSTRAINT "initiatives_items_chk" CHECK ("initiatives"."done_items" is null or "initiatives"."total_items" is null or ("initiatives"."done_items" >= 0 and "initiatives"."done_items" <= "initiatives"."total_items"))
);
--> statement-breakpoint
ALTER TABLE "initiative_milestones" ADD CONSTRAINT "initiative_milestones_initiative_id_initiatives_id_fk" FOREIGN KEY ("initiative_id") REFERENCES "public"."initiatives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "initiative_milestones_initiative_idx" ON "initiative_milestones" USING btree ("initiative_id");--> statement-breakpoint
CREATE UNIQUE INDEX "initiatives_period_key_uq" ON "initiatives" USING btree ("year","quarter","jira_key");--> statement-breakpoint
CREATE INDEX "initiatives_period_idx" ON "initiatives" USING btree ("year","quarter");
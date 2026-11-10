CREATE TYPE "public"."item_status" AS ENUM('not_started', 'on_track', 'at_risk', 'done', 'not_achieved');--> statement-breakpoint
CREATE TYPE "public"."plan_status" AS ENUM('draft', 'submitted');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."template_source" AS ENUM('scratch', 'google_sheet', 'xlsx');--> statement-breakpoint
CREATE TYPE "public"."template_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TABLE "connections" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"jira_account_id" text,
	"jira_display_name" text,
	"jira_board_id" integer,
	"bitbucket_uuid" text,
	"bitbucket_display_name" text,
	"bitbucket_nickname" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pgp_plan_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"company_okr" text,
	"objective" text DEFAULT '' NOT NULL,
	"key_result" text DEFAULT '' NOT NULL,
	"weight" numeric(6, 2) DEFAULT 0 NOT NULL,
	"initiative" text DEFAULT '' NOT NULL,
	"plan_id" uuid NOT NULL,
	"template_item_id" uuid,
	"start_value" text,
	"target_value" text,
	"current_value" text,
	"achievement" numeric(6, 2),
	"status" "item_status" DEFAULT 'not_started' NOT NULL,
	"evidence_links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "pgp_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"division" text,
	"sbu" text,
	"sbu_detail" text,
	"direct_leader" text,
	"status" "plan_status" DEFAULT 'draft' NOT NULL,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pgp_template_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"company_okr" text,
	"objective" text DEFAULT '' NOT NULL,
	"key_result" text DEFAULT '' NOT NULL,
	"weight" numeric(6, 2) DEFAULT 0 NOT NULL,
	"initiative" text DEFAULT '' NOT NULL,
	"template_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pgp_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"period" text NOT NULL,
	"source" "template_source" DEFAULT 'scratch' NOT NULL,
	"source_ref" text,
	"status" "template_status" DEFAULT 'draft' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"avatar_url" text,
	"oauth_subject" text,
	"role" "user_role" DEFAULT 'member' NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pgp_plan_items" ADD CONSTRAINT "pgp_plan_items_plan_id_pgp_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."pgp_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pgp_plan_items" ADD CONSTRAINT "pgp_plan_items_template_item_id_pgp_template_items_id_fk" FOREIGN KEY ("template_item_id") REFERENCES "public"."pgp_template_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pgp_plans" ADD CONSTRAINT "pgp_plans_template_id_pgp_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."pgp_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pgp_plans" ADD CONSTRAINT "pgp_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pgp_template_items" ADD CONSTRAINT "pgp_template_items_template_id_pgp_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."pgp_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pgp_templates" ADD CONSTRAINT "pgp_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_items_plan_idx" ON "pgp_plan_items" USING btree ("plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plans_template_user_uq" ON "pgp_plans" USING btree ("template_id","user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "template_items_template_idx" ON "pgp_template_items" USING btree ("template_id");
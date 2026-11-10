CREATE TABLE "reporting_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"leader_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reporting_requests_not_self" CHECK ("reporting_requests"."report_id" <> "reporting_requests"."leader_id"),
	CONSTRAINT "reporting_requests_requester" CHECK ("reporting_requests"."requested_by" in ("reporting_requests"."report_id", "reporting_requests"."leader_id"))
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "manager_id" uuid;--> statement-breakpoint
ALTER TABLE "reporting_requests" ADD CONSTRAINT "reporting_requests_report_id_users_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reporting_requests" ADD CONSTRAINT "reporting_requests_leader_id_users_id_fk" FOREIGN KEY ("leader_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reporting_requests" ADD CONSTRAINT "reporting_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reporting_requests_report_uq" ON "reporting_requests" USING btree ("report_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "users_manager_idx" ON "users" USING btree ("manager_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_manager_not_self" CHECK ("users"."manager_id" <> "users"."id");
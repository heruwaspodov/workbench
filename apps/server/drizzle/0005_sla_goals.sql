CREATE TABLE "sla_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"priority" text NOT NULL,
	"label" text NOT NULL,
	"calendar" text NOT NULL,
	"target" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sla_goals_calendar_chk" CHECK ("sla_goals"."calendar" in ('weekdays', 'always'))
);
--> statement-breakpoint
CREATE INDEX "sla_goals_position_idx" ON "sla_goals" USING btree ("position");
--> statement-breakpoint
-- Defaults copied from the Time to SLA configuration "Mekari Sign SLA Panel" (read 2026-11-11). Admins can edit them in the app.
INSERT INTO "sla_goals" ("position", "name", "priority", "label", "calendar", "target") VALUES
	(1, 'VIP Time Weekday', 'Highest - P0', 'vip-mesign-p0', 'weekdays', '8h'),
	(2, 'Weekend VIP PZero', 'Highest - P0', 'weekend-vip-mesign-p0', 'weekdays', '10h'),
	(3, 'P1 Mekari Sign VIP', 'High - P1', 'vip-mesign-p1', 'weekdays', '1d12h'),
	(4, 'P1 General', 'High - P1', 'mesign-p1', 'weekdays', '2d'),
	(5, 'P2 VIP', 'Medium - P2', 'vip-mesign-p2', 'always', '3d'),
	(6, 'P2 General', 'Medium - P2', 'mesign-p2', 'weekdays', '5d'),
	(7, 'P3 VIP', 'Low - P3', 'vip-mesign-p3', 'always', '10d'),
	(8, 'P3 General', 'Low - P3', 'mesign-p3', 'always', '15d');

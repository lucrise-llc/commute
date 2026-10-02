CREATE TABLE `resolution` (
	`key` text PRIMARY KEY,
	`lines` text,
	`dropped` text NOT NULL,
	`reason` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `change` ADD `resolved_conflicts` text;
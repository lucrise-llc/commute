CREATE TABLE `batch` (
	`id` text PRIMARY KEY,
	`approver` text NOT NULL,
	`change_ids` text NOT NULL,
	`state` text NOT NULL,
	`trunk_before` text NOT NULL,
	`trunk_after` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `change` (
	`id` text PRIMARY KEY,
	`number` integer NOT NULL,
	`intent` text NOT NULL,
	`owner` text,
	`state` text NOT NULL,
	`base_commit` text,
	`head_commit` text,
	`restack_conflicts` text,
	`batch_id` text,
	`landed_commit` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `event` (
	`seq` integer PRIMARY KEY AUTOINCREMENT,
	`change_id` text NOT NULL,
	`at` text NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `footprint` (
	`change_id` text NOT NULL,
	`source` text NOT NULL,
	`path` text NOT NULL,
	CONSTRAINT `footprint_pk` PRIMARY KEY(`change_id`, `source`, `path`)
);
--> statement-breakpoint
CREATE TABLE `job` (
	`key` text PRIMARY KEY,
	`kind` text NOT NULL,
	`version` integer NOT NULL,
	`attempts` integer NOT NULL,
	`run_after` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `merge_check` (
	`left_id` text NOT NULL,
	`right_id` text NOT NULL,
	`left_head` text NOT NULL,
	`right_head` text NOT NULL,
	`outcome` text NOT NULL,
	`conflicts` text NOT NULL,
	CONSTRAINT `merge_check_pk` PRIMARY KEY(`left_id`, `right_id`)
);
--> statement-breakpoint
CREATE TABLE `project` (
	`id` text PRIMARY KEY,
	`change_count` integer NOT NULL,
	`batch_count` integer NOT NULL,
	`trunk_head` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reported_overlap` (
	`change_id` text NOT NULL,
	`other_change_id` text NOT NULL,
	`path` text NOT NULL,
	`other_path` text NOT NULL,
	CONSTRAINT `reported_overlap_pk` PRIMARY KEY(`change_id`, `other_change_id`, `path`, `other_path`)
);

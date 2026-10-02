CREATE TABLE `change_check` (
	`change_id` text NOT NULL,
	`name` text NOT NULL,
	`head` text NOT NULL,
	`key` text NOT NULL,
	`command` text NOT NULL,
	`reads` text NOT NULL,
	`previous_reads` text,
	`kept` integer NOT NULL,
	`outcome` text NOT NULL,
	CONSTRAINT `change_check_pk` PRIMARY KEY(`change_id`, `name`)
);
--> statement-breakpoint
CREATE TABLE `check_result` (
	`key` text PRIMARY KEY,
	`name` text NOT NULL,
	`outcome` text NOT NULL,
	`exit_code` integer NOT NULL,
	`output` text NOT NULL,
	`ran_for` text NOT NULL,
	`ran_at` text NOT NULL
);

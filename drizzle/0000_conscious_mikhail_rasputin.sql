CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_name_unique` ON `categories` (`name`);--> statement-breakpoint
CREATE TABLE `highlights` (
	`id` text PRIMARY KEY NOT NULL,
	`memory_id` text NOT NULL,
	`text` text NOT NULL,
	`prefix` text NOT NULL,
	`suffix` text NOT NULL,
	`start_offset` integer NOT NULL,
	`end_offset` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`memory_id`) REFERENCES `memories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `highlights_memory_id_idx` ON `highlights` (`memory_id`);--> statement-breakpoint
CREATE INDEX `highlights_created_at_idx` ON `highlights` (`created_at`);--> statement-breakpoint
CREATE TABLE `memories` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`favicon_url` text,
	`content_path` text NOT NULL,
	`extraction_status` text NOT NULL,
	`extraction_error` text,
	`backup_status` text NOT NULL,
	`last_backup_at` integer,
	`last_backup_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "memories_extraction_status_check" CHECK("memories"."extraction_status" in ('pending', 'success', 'link_only', 'failed')),
	CONSTRAINT "memories_backup_status_check" CHECK("memories"."backup_status" in ('pending', 'queued', 'success', 'failed', 'disabled'))
);
--> statement-breakpoint
CREATE INDEX `memories_url_idx` ON `memories` (`url`);--> statement-breakpoint
CREATE INDEX `memories_created_at_idx` ON `memories` (`created_at`);--> statement-breakpoint
CREATE INDEX `memories_extraction_status_idx` ON `memories` (`extraction_status`);--> statement-breakpoint
CREATE INDEX `memories_backup_status_idx` ON `memories` (`backup_status`);--> statement-breakpoint
CREATE TABLE `memory_categories` (
	`memory_id` text NOT NULL,
	`category_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`memory_id`, `category_id`),
	FOREIGN KEY (`memory_id`) REFERENCES `memories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `memory_categories_category_id_idx` ON `memory_categories` (`category_id`);--> statement-breakpoint
CREATE TABLE `memory_tags` (
	`memory_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`memory_id`, `tag_id`),
	FOREIGN KEY (`memory_id`) REFERENCES `memories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `memory_tags_tag_id_idx` ON `memory_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_name_unique` ON `tags` (`name`);
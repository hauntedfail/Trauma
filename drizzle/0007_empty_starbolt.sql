CREATE TABLE `flashbacks` (
	`id` text PRIMARY KEY NOT NULL,
	`memory_id` text NOT NULL,
	`section_anchor` text NOT NULL,
	`section_title` text NOT NULL,
	`section_level` integer NOT NULL,
	`section_path` text NOT NULL,
	`section_start_offset` integer,
	`section_end_offset` integer,
	`content_hash` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`memory_id`) REFERENCES `memories`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "flashbacks_section_anchor_check" CHECK(length("flashbacks"."section_anchor") > 0),
	CONSTRAINT "flashbacks_section_title_check" CHECK(length("flashbacks"."section_title") > 0),
	CONSTRAINT "flashbacks_section_level_check" CHECK("flashbacks"."section_level" >= 1 and "flashbacks"."section_level" <= 6),
	CONSTRAINT "flashbacks_section_offset_check" CHECK(("flashbacks"."section_start_offset" is null and "flashbacks"."section_end_offset" is null) or ("flashbacks"."section_start_offset" is not null and "flashbacks"."section_end_offset" is not null and "flashbacks"."section_start_offset" >= 0 and "flashbacks"."section_end_offset" > "flashbacks"."section_start_offset"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `flashbacks_memory_section_anchor_unique` ON `flashbacks` (`memory_id`,`section_anchor`);--> statement-breakpoint
CREATE INDEX `flashbacks_memory_id_idx` ON `flashbacks` (`memory_id`);--> statement-breakpoint
CREATE INDEX `flashbacks_created_at_idx` ON `flashbacks` (`created_at`);
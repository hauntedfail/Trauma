PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_moments` (
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
	CONSTRAINT "moments_section_anchor_check" CHECK(length("section_anchor") > 0),
	CONSTRAINT "moments_section_title_check" CHECK(length("section_title") > 0),
	CONSTRAINT "moments_section_level_check" CHECK("section_level" >= 1 and "section_level" <= 6),
	CONSTRAINT "moments_section_offset_check" CHECK(("section_start_offset" is null and "section_end_offset" is null) or ("section_start_offset" is not null and "section_end_offset" is not null and "section_start_offset" >= 0 and "section_end_offset" > "section_start_offset"))
);
--> statement-breakpoint
INSERT INTO `__new_moments` (
	`id`,
	`memory_id`,
	`section_anchor`,
	`section_title`,
	`section_level`,
	`section_path`,
	`section_start_offset`,
	`section_end_offset`,
	`content_hash`,
	`created_at`,
	`updated_at`
)
SELECT
	`id`,
	`memory_id`,
	`section_anchor`,
	`section_title`,
	`section_level`,
	`section_path`,
	`section_start_offset`,
	`section_end_offset`,
	`content_hash`,
	`created_at`,
	`updated_at`
FROM `flashbacks`;
--> statement-breakpoint
CREATE TABLE `__new_flashbacks` (
	`id` text PRIMARY KEY NOT NULL,
	`memory_id` text NOT NULL,
	`text` text NOT NULL,
	`prefix` text NOT NULL,
	`suffix` text NOT NULL,
	`start_offset` integer NOT NULL,
	`end_offset` integer NOT NULL,
	`content_hash` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`memory_id`) REFERENCES `memories`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "flashbacks_start_offset_check" CHECK("start_offset" >= 0),
	CONSTRAINT "flashbacks_end_offset_check" CHECK("end_offset" > "start_offset")
);
--> statement-breakpoint
INSERT INTO `__new_flashbacks` (
	`id`,
	`memory_id`,
	`text`,
	`prefix`,
	`suffix`,
	`start_offset`,
	`end_offset`,
	`content_hash`,
	`created_at`,
	`updated_at`
)
SELECT
	`id`,
	`memory_id`,
	`text`,
	`prefix`,
	`suffix`,
	`start_offset`,
	`end_offset`,
	`content_hash`,
	`created_at`,
	`updated_at`
FROM `highlights`;
--> statement-breakpoint
DROP TABLE `flashbacks`;
--> statement-breakpoint
DROP TABLE `highlights`;
--> statement-breakpoint
ALTER TABLE `__new_moments` RENAME TO `moments`;
--> statement-breakpoint
ALTER TABLE `__new_flashbacks` RENAME TO `flashbacks`;
--> statement-breakpoint
CREATE UNIQUE INDEX `moments_memory_section_anchor_unique` ON `moments` (`memory_id`,`section_anchor`);
--> statement-breakpoint
CREATE INDEX `moments_memory_id_idx` ON `moments` (`memory_id`);
--> statement-breakpoint
CREATE INDEX `moments_created_at_idx` ON `moments` (`created_at`);
--> statement-breakpoint
CREATE INDEX `flashbacks_memory_id_idx` ON `flashbacks` (`memory_id`);
--> statement-breakpoint
CREATE INDEX `flashbacks_created_at_idx` ON `flashbacks` (`created_at`);
--> statement-breakpoint
PRAGMA foreign_keys=ON;

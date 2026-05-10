PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_highlights` (
	`id` text PRIMARY KEY NOT NULL,
	`memory_id` text NOT NULL,
	`text` text NOT NULL,
	`prefix` text NOT NULL,
	`suffix` text NOT NULL,
	`start_offset` integer NOT NULL,
	`end_offset` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`memory_id`) REFERENCES `memories`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "highlights_start_offset_check" CHECK("start_offset" >= 0),
	CONSTRAINT "highlights_end_offset_check" CHECK("end_offset" >= "start_offset")
);
--> statement-breakpoint
INSERT INTO `__new_highlights`("id", "memory_id", "text", "prefix", "suffix", "start_offset", "end_offset", "created_at", "updated_at") SELECT "id", "memory_id", "text", "prefix", "suffix", "start_offset", "end_offset", "created_at", "updated_at" FROM `highlights`;--> statement-breakpoint
DROP TABLE `highlights`;--> statement-breakpoint
ALTER TABLE `__new_highlights` RENAME TO `highlights`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `highlights_memory_id_idx` ON `highlights` (`memory_id`);--> statement-breakpoint
CREATE INDEX `highlights_created_at_idx` ON `highlights` (`created_at`);

ALTER TABLE `memories` ADD COLUMN `triage_state` text DEFAULT 'shelf' NOT NULL CHECK (`triage_state` in ('shelf', 'today', 'library', 'archive'));--> statement-breakpoint
ALTER TABLE `memories` ADD COLUMN `triage_changed_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `memories` ADD COLUMN `last_position` text;--> statement-breakpoint
ALTER TABLE `memories` ADD COLUMN `last_opened_at` integer;--> statement-breakpoint
ALTER TABLE `memories` ADD COLUMN `word_count` integer;--> statement-breakpoint
UPDATE `memories` SET `triage_state` = CASE WHEN `read` = 1 THEN 'library' ELSE 'shelf' END, `triage_changed_at` = COALESCE(`updated_at`, `created_at`);--> statement-breakpoint
CREATE INDEX `memories_triage_state_created_at_id_idx` ON `memories` (`triage_state`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `memories_last_opened_at_id_idx` ON `memories` (`last_opened_at`,`id`);
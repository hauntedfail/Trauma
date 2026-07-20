DROP INDEX `flashbacks_created_at_idx`;--> statement-breakpoint
CREATE INDEX `flashbacks_created_at_id_idx` ON `flashbacks` (`created_at`,`id`);--> statement-breakpoint
DROP INDEX `moments_created_at_idx`;--> statement-breakpoint
CREATE INDEX `moments_created_at_id_idx` ON `moments` (`created_at`,`id`);
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_flashbacks` (
	`id` text PRIMARY KEY NOT NULL,
	`memory_id` text NOT NULL,
	`variant_kind` text DEFAULT 'source' NOT NULL,
	`lang_code` text,
	`translation_output_hash` text,
	`text` text NOT NULL,
	`prefix` text NOT NULL,
	`suffix` text NOT NULL,
	`start_offset` integer NOT NULL,
	`end_offset` integer NOT NULL,
	`content_hash` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`memory_id`) REFERENCES `memories`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "flashbacks_variant_kind_check" CHECK(`variant_kind` in ('source', 'translation')),
	CONSTRAINT "flashbacks_variant_scope_check" CHECK((`variant_kind` = 'source' and `lang_code` is null and `translation_output_hash` is null) or (`variant_kind` = 'translation' and `lang_code` is not null and `lang_code` in ('ja-JP', 'en-US', 'en-GB', 'ko-KR', 'zh-CN', 'zh-TW', 'fr-FR', 'de-DE', 'es-ES', 'pt-BR') and `translation_output_hash` is not null and `translation_output_hash` glob 'sha256:*')),
	CONSTRAINT "flashbacks_start_offset_check" CHECK(`start_offset` >= 0),
	CONSTRAINT "flashbacks_end_offset_check" CHECK(`end_offset` > `start_offset`)
);
--> statement-breakpoint
INSERT INTO `__new_flashbacks` (
	`id`,
	`memory_id`,
	`variant_kind`,
	`lang_code`,
	`translation_output_hash`,
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
	'source',
	NULL,
	NULL,
	`text`,
	`prefix`,
	`suffix`,
	`start_offset`,
	`end_offset`,
	`content_hash`,
	`created_at`,
	`updated_at`
FROM `flashbacks`;
--> statement-breakpoint
DROP TABLE `flashbacks`;
--> statement-breakpoint
ALTER TABLE `__new_flashbacks` RENAME TO `flashbacks`;
--> statement-breakpoint
CREATE INDEX `flashbacks_memory_id_idx` ON `flashbacks` (`memory_id`);
--> statement-breakpoint
CREATE INDEX `flashbacks_created_at_idx` ON `flashbacks` (`created_at`);
--> statement-breakpoint
CREATE INDEX `flashbacks_memory_variant_idx` ON `flashbacks` (`memory_id`,`variant_kind`,`lang_code`,`translation_output_hash`,`start_offset`);
--> statement-breakpoint
PRAGMA foreign_keys=ON;

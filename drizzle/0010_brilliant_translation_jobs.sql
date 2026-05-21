PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_app_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`translation_target_language` text DEFAULT 'ja-JP' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "app_settings_id_check" CHECK(`id` = 'default'),
	CONSTRAINT "app_settings_translation_target_language_check" CHECK(`translation_target_language` in ('ja-JP', 'en-US', 'en-GB', 'ko-KR', 'zh-CN', 'zh-TW', 'fr-FR', 'de-DE', 'es-ES', 'pt-BR'))
);
--> statement-breakpoint
INSERT INTO `__new_app_settings` (`id`, `translation_target_language`, `created_at`, `updated_at`)
SELECT
	`id`,
	CASE
		WHEN `translation_target_language` IN ('ja-JP', 'en-US', 'en-GB', 'ko-KR', 'zh-CN', 'zh-TW', 'fr-FR', 'de-DE', 'es-ES', 'pt-BR') THEN `translation_target_language`
		ELSE 'ja-JP'
	END,
	`created_at`,
	`updated_at`
FROM `app_settings`;
--> statement-breakpoint
DROP TABLE `app_settings`;
--> statement-breakpoint
ALTER TABLE `__new_app_settings` RENAME TO `app_settings`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint
CREATE TABLE `translation_jobs` (
	`job_id` text PRIMARY KEY NOT NULL,
	`memory_id` text NOT NULL,
	`lang_code` text NOT NULL,
	`source_hash` text NOT NULL,
	`model` text,
	`prompt_policy_version` text NOT NULL,
	`chunker_version` text NOT NULL,
	`status` text NOT NULL,
	`chunk_count` integer DEFAULT 0 NOT NULL,
	`output_path` text,
	`output_hash` text,
	`error` text,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`memory_id`) REFERENCES `memories`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "translation_jobs_status_check" CHECK(`status` in ('pending', 'running', 'stale', 'cancel_requested', 'canceled', 'unavailable', 'stitching', 'committing', 'complete', 'failed')),
	CONSTRAINT "translation_jobs_source_hash_check" CHECK(`source_hash` glob 'sha256:*'),
	CONSTRAINT "translation_jobs_output_hash_check" CHECK(`output_hash` is null or `output_hash` glob 'sha256:*'),
	CONSTRAINT "translation_jobs_chunk_count_check" CHECK(`chunk_count` >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `translation_jobs_current_complete_idx` ON `translation_jobs` (`memory_id`,`lang_code`,`source_hash`) WHERE `status` = 'complete';
--> statement-breakpoint
CREATE UNIQUE INDEX `translation_jobs_active_idx` ON `translation_jobs` (`memory_id`,`lang_code`,`source_hash`) WHERE `status` in ('pending', 'running', 'cancel_requested', 'stitching', 'committing');
--> statement-breakpoint
CREATE INDEX `translation_jobs_memory_lang_idx` ON `translation_jobs` (`memory_id`,`lang_code`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `translation_chunks` (
	`job_id` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`source_chunk_hash` text NOT NULL,
	`block_ids_json` text NOT NULL,
	`status` text NOT NULL,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`translated_markdown` text,
	`translated_hash` text,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`job_id`, `chunk_index`),
	FOREIGN KEY (`job_id`) REFERENCES `translation_jobs`(`job_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "translation_chunks_status_check" CHECK(`status` in ('pending', 'running', 'validating', 'retrying', 'complete', 'purged', 'failed')),
	CONSTRAINT "translation_chunks_source_hash_check" CHECK(`source_chunk_hash` glob 'sha256:*'),
	CONSTRAINT "translation_chunks_translated_hash_check" CHECK(`translated_hash` is null or `translated_hash` glob 'sha256:*'),
	CONSTRAINT "translation_chunks_retry_count_check" CHECK(`retry_count` >= 0),
	CONSTRAINT "translation_chunks_index_check" CHECK(`chunk_index` >= 0)
);
--> statement-breakpoint
CREATE INDEX `translation_chunks_status_idx` ON `translation_chunks` (`job_id`,`status`,`chunk_index`);

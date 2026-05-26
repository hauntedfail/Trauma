PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_app_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`translation_target_language` text DEFAULT 'ja-JP' NOT NULL,
	`codex_translation_model` text,
	`codex_translation_reasoning_effort` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "app_settings_id_check" CHECK("id" = 'default'),
	CONSTRAINT "app_settings_translation_target_language_check" CHECK("translation_target_language" in ('ja-JP', 'en-US', 'en-GB', 'ko-KR', 'zh-CN', 'zh-TW', 'fr-FR', 'de-DE', 'es-ES', 'pt-BR')),
	CONSTRAINT "app_settings_codex_translation_reasoning_effort_check" CHECK("codex_translation_reasoning_effort" is null or "codex_translation_reasoning_effort" in ('none', 'minimal', 'low', 'medium', 'high', 'xhigh'))
);
--> statement-breakpoint
INSERT INTO `__new_app_settings`("id", "translation_target_language", "codex_translation_model", "codex_translation_reasoning_effort", "created_at", "updated_at") SELECT "id", "translation_target_language", null, null, "created_at", "updated_at" FROM `app_settings`;--> statement-breakpoint
DROP TABLE `app_settings`;--> statement-breakpoint
ALTER TABLE `__new_app_settings` RENAME TO `app_settings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_translation_jobs` (
	`job_id` text PRIMARY KEY NOT NULL,
	`memory_id` text NOT NULL,
	`lang_code` text NOT NULL,
	`source_hash` text NOT NULL,
	`model` text,
	`reasoning_effort` text,
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
	CONSTRAINT "translation_jobs_status_check" CHECK("status" in ('pending', 'running', 'stale', 'cancel_requested', 'canceled', 'unavailable', 'stitching', 'committing', 'complete', 'failed')),
	CONSTRAINT "translation_jobs_source_hash_check" CHECK("source_hash" glob 'sha256:*'),
	CONSTRAINT "translation_jobs_output_hash_check" CHECK("output_hash" is null or "output_hash" glob 'sha256:*'),
	CONSTRAINT "translation_jobs_reasoning_effort_check" CHECK("reasoning_effort" is null or "reasoning_effort" in ('none', 'minimal', 'low', 'medium', 'high', 'xhigh')),
	CONSTRAINT "translation_jobs_chunk_count_check" CHECK("chunk_count" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_translation_jobs`("job_id", "memory_id", "lang_code", "source_hash", "model", "reasoning_effort", "prompt_policy_version", "chunker_version", "status", "chunk_count", "output_path", "output_hash", "error", "completed_at", "created_at", "updated_at") SELECT "job_id", "memory_id", "lang_code", "source_hash", "model", null, "prompt_policy_version", "chunker_version", "status", "chunk_count", "output_path", "output_hash", "error", "completed_at", "created_at", "updated_at" FROM `translation_jobs`;--> statement-breakpoint
DROP TABLE `translation_jobs`;--> statement-breakpoint
ALTER TABLE `__new_translation_jobs` RENAME TO `translation_jobs`;--> statement-breakpoint
CREATE UNIQUE INDEX `translation_jobs_current_complete_idx` ON `translation_jobs` (`memory_id`,`lang_code`,`source_hash`) WHERE "translation_jobs"."status" = 'complete';--> statement-breakpoint
CREATE UNIQUE INDEX `translation_jobs_active_idx` ON `translation_jobs` (`memory_id`,`lang_code`,`source_hash`) WHERE "translation_jobs"."status" in ('pending', 'running', 'cancel_requested', 'stitching', 'committing');--> statement-breakpoint
CREATE INDEX `translation_jobs_memory_lang_idx` ON `translation_jobs` (`memory_id`,`lang_code`,`updated_at`);

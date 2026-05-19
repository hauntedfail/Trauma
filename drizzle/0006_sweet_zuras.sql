CREATE TABLE `app_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`translation_target_language` text DEFAULT 'ja-JP' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "app_settings_id_check" CHECK("app_settings"."id" = 'default'),
	CONSTRAINT "app_settings_translation_target_language_check" CHECK("app_settings"."translation_target_language" in ('ja-JP', 'en-US', 'ko-KR', 'zh-CN', 'fr-FR', 'de-DE', 'es-ES', 'it-IT', 'pt-BR'))
);
--> statement-breakpoint
CREATE TABLE `openai_auth_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`credential_reference` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "openai_auth_credentials_id_check" CHECK("openai_auth_credentials"."id" = 'default')
);

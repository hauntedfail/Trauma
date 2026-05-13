CREATE TABLE `backup_environment_stamps` (
	`id` text PRIMARY KEY NOT NULL,
	`project_path` text NOT NULL,
	`store_path` text NOT NULL,
	`git_remote` text NOT NULL,
	`git_remote_url` text,
	`git_branch` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "backup_environment_stamps_id_check" CHECK("backup_environment_stamps"."id" = 'default')
);
--> statement-breakpoint
CREATE TABLE `backup_failsafe_alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`severity` text NOT NULL,
	`message` text NOT NULL,
	`previous_project_path` text,
	`previous_store_path` text,
	`current_project_path` text NOT NULL,
	`current_store_path` text NOT NULL,
	`git_remote` text NOT NULL,
	`git_remote_url` text,
	`git_branch` text NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "backup_failsafe_alerts_id_check" CHECK("backup_failsafe_alerts"."id" = 'active'),
	CONSTRAINT "backup_failsafe_alerts_kind_check" CHECK("backup_failsafe_alerts"."kind" in ('backup_path_drift', 'backup_repository_missing', 'backup_push_failed')),
	CONSTRAINT "backup_failsafe_alerts_severity_check" CHECK("backup_failsafe_alerts"."severity" in ('critical'))
);

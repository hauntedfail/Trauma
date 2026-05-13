PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_backup_failsafe_alerts` (
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
	CONSTRAINT "backup_failsafe_alerts_id_check" CHECK("id" = 'active'),
	CONSTRAINT "backup_failsafe_alerts_kind_check" CHECK("kind" in ('backup_path_drift', 'backup_content_inconsistent', 'backup_repository_missing', 'backup_push_failed')),
	CONSTRAINT "backup_failsafe_alerts_severity_check" CHECK("severity" in ('critical'))
);
--> statement-breakpoint
INSERT INTO `__new_backup_failsafe_alerts`("id", "kind", "severity", "message", "previous_project_path", "previous_store_path", "current_project_path", "current_store_path", "git_remote", "git_remote_url", "git_branch", "error", "created_at", "updated_at") SELECT "id", "kind", "severity", "message", "previous_project_path", "previous_store_path", "current_project_path", "current_store_path", "git_remote", "git_remote_url", "git_branch", "error", "created_at", "updated_at" FROM `backup_failsafe_alerts`;--> statement-breakpoint
DROP TABLE `backup_failsafe_alerts`;--> statement-breakpoint
ALTER TABLE `__new_backup_failsafe_alerts` RENAME TO `backup_failsafe_alerts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;

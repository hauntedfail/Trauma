UPDATE `memories`
SET `last_backup_error` = NULL
WHERE `last_backup_error` IS NOT NULL;
--> statement-breakpoint
UPDATE `backup_environment_stamps`
SET `git_remote_url` = 'redacted:migration-0016'
WHERE `git_remote_url` IS NOT NULL
  AND `git_remote_url` NOT LIKE 'sha256:%';

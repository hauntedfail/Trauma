UPDATE `backup_environment_stamps`
SET `git_remote_url` = 'redacted:migration-0016'
WHERE `git_remote_url` IS NOT NULL;
--> statement-breakpoint
UPDATE `backup_failsafe_alerts`
SET `git_remote_url` = NULL,
    `error` = CASE
      WHEN `kind` = 'backup_push_failed' THEN NULL
      ELSE `error`
    END;

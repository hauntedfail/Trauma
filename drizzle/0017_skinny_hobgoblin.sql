DELETE FROM `moments`
WHERE `id` IN (
	SELECT `id`
	FROM (
		SELECT
			`id`,
			row_number() OVER (
				PARTITION BY `memory_id`, `section_path`
				ORDER BY `updated_at` DESC, `created_at` ASC, `id` ASC
			) AS `duplicate_rank`
		FROM `moments`
	)
	WHERE `duplicate_rank` > 1
);
--> statement-breakpoint
CREATE UNIQUE INDEX `moments_memory_section_path_unique` ON `moments` (`memory_id`,`section_path`);

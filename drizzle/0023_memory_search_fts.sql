CREATE VIRTUAL TABLE IF NOT EXISTS `memory_search_fts` USING fts5(
	`memory_id` UNINDEXED,
	`title`,
	`url`,
	`description`,
	`body_text`,
	tokenize='unicode61'
);

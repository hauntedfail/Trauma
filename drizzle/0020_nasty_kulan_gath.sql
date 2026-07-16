CREATE TABLE IF NOT EXISTS `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `memory_categories` (
	`memory_id` text NOT NULL,
	`category_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`memory_id`, `category_id`),
	FOREIGN KEY (`memory_id`) REFERENCES `memories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `memory_categories_category_id_idx` ON `memory_categories` (`category_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `memory_tags` (
	`memory_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`memory_id`, `tag_id`),
	FOREIGN KEY (`memory_id`) REFERENCES `memories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `memory_tags_tag_id_idx` ON `memory_tags` (`tag_id`);--> statement-breakpoint
DROP TABLE IF EXISTS `__taxonomy_tag_survivors`;--> statement-breakpoint
CREATE TEMP TABLE `__taxonomy_tag_survivors` AS
SELECT
	`duplicate`.`id` AS `duplicate_id`,
	(
		SELECT `survivor`.`id`
		FROM `tags` AS `survivor`
		WHERE lower(`survivor`.`name`) = lower(`duplicate`.`name`)
		ORDER BY `survivor`.`created_at` ASC, `survivor`.`id` ASC
		LIMIT 1
	) AS `survivor_id`
FROM `tags` AS `duplicate`;--> statement-breakpoint
DROP TABLE IF EXISTS `__taxonomy_memory_tags`;--> statement-breakpoint
CREATE TEMP TABLE `__taxonomy_memory_tags` AS
SELECT
	`memory_tags`.`memory_id` AS `memory_id`,
	`survivors`.`survivor_id` AS `tag_id`,
	min(`memory_tags`.`created_at`) AS `created_at`,
	max(`memory_tags`.`updated_at`) AS `updated_at`
FROM `memory_tags`
INNER JOIN `__taxonomy_tag_survivors` AS `survivors`
	ON `survivors`.`duplicate_id` = `memory_tags`.`tag_id`
GROUP BY `memory_tags`.`memory_id`, `survivors`.`survivor_id`;--> statement-breakpoint
DELETE FROM `memory_tags`;--> statement-breakpoint
INSERT INTO `memory_tags` (`memory_id`, `tag_id`, `created_at`, `updated_at`)
SELECT `memory_id`, `tag_id`, `created_at`, `updated_at`
FROM `__taxonomy_memory_tags`;--> statement-breakpoint
DELETE FROM `tags`
WHERE `id` IN (
	SELECT `duplicate_id`
	FROM `__taxonomy_tag_survivors`
	WHERE `duplicate_id` <> `survivor_id`
);--> statement-breakpoint
DROP TABLE `__taxonomy_memory_tags`;--> statement-breakpoint
DROP TABLE `__taxonomy_tag_survivors`;--> statement-breakpoint
DROP TABLE IF EXISTS `__taxonomy_category_survivors`;--> statement-breakpoint
CREATE TEMP TABLE `__taxonomy_category_survivors` AS
SELECT
	`duplicate`.`id` AS `duplicate_id`,
	(
		SELECT `survivor`.`id`
		FROM `categories` AS `survivor`
		WHERE lower(`survivor`.`name`) = lower(`duplicate`.`name`)
		ORDER BY `survivor`.`created_at` ASC, `survivor`.`id` ASC
		LIMIT 1
	) AS `survivor_id`
FROM `categories` AS `duplicate`;--> statement-breakpoint
DROP TABLE IF EXISTS `__taxonomy_memory_categories`;--> statement-breakpoint
CREATE TEMP TABLE `__taxonomy_memory_categories` AS
SELECT
	`memory_categories`.`memory_id` AS `memory_id`,
	`survivors`.`survivor_id` AS `category_id`,
	min(`memory_categories`.`created_at`) AS `created_at`,
	max(`memory_categories`.`updated_at`) AS `updated_at`
FROM `memory_categories`
INNER JOIN `__taxonomy_category_survivors` AS `survivors`
	ON `survivors`.`duplicate_id` = `memory_categories`.`category_id`
GROUP BY `memory_categories`.`memory_id`, `survivors`.`survivor_id`;--> statement-breakpoint
DELETE FROM `memory_categories`;--> statement-breakpoint
INSERT INTO `memory_categories` (`memory_id`, `category_id`, `created_at`, `updated_at`)
SELECT `memory_id`, `category_id`, `created_at`, `updated_at`
FROM `__taxonomy_memory_categories`;--> statement-breakpoint
DELETE FROM `categories`
WHERE `id` IN (
	SELECT `duplicate_id`
	FROM `__taxonomy_category_survivors`
	WHERE `duplicate_id` <> `survivor_id`
);--> statement-breakpoint
DROP TABLE `__taxonomy_memory_categories`;--> statement-breakpoint
DROP TABLE `__taxonomy_category_survivors`;--> statement-breakpoint
DROP INDEX IF EXISTS `categories_name_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `categories_name_unique` ON `categories` (lower("name"));--> statement-breakpoint
DROP INDEX IF EXISTS `tags_name_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `tags_name_unique` ON `tags` (lower("name"));

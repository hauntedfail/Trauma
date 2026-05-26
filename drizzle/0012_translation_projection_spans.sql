ALTER TABLE `translation_chunks` ADD `projection_spans_json` text;--> statement-breakpoint
CREATE TABLE `translation_projection_spans` (
	`job_id` text NOT NULL,
	`span_index` integer NOT NULL,
	`memory_id` text NOT NULL,
	`lang_code` text NOT NULL,
	`source_hash` text NOT NULL,
	`output_hash` text NOT NULL,
	`segment_id` text NOT NULL,
	`block_id` text NOT NULL,
	`source_markdown_start` integer NOT NULL,
	`source_markdown_end` integer NOT NULL,
	`translated_markdown_start` integer NOT NULL,
	`translated_markdown_end` integer NOT NULL,
	`source_reader_start` integer NOT NULL,
	`source_reader_end` integer NOT NULL,
	`translated_reader_start` integer NOT NULL,
	`translated_reader_end` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`job_id`, `span_index`),
	FOREIGN KEY (`job_id`) REFERENCES `translation_jobs`(`job_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`memory_id`) REFERENCES `memories`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "translation_projection_source_hash_check" CHECK(`source_hash` glob 'sha256:*'),
	CONSTRAINT "translation_projection_output_hash_check" CHECK(`output_hash` glob 'sha256:*'),
	CONSTRAINT "translation_projection_source_markdown_range_check" CHECK(`source_markdown_end` > `source_markdown_start`),
	CONSTRAINT "translation_projection_translated_markdown_range_check" CHECK(`translated_markdown_end` > `translated_markdown_start`),
	CONSTRAINT "translation_projection_source_reader_range_check" CHECK(`source_reader_end` > `source_reader_start`),
	CONSTRAINT "translation_projection_translated_reader_range_check" CHECK(`translated_reader_end` > `translated_reader_start`)
);
--> statement-breakpoint
CREATE INDEX `translation_projection_current_idx` ON `translation_projection_spans` (`memory_id`,`lang_code`,`source_hash`,`output_hash`,`span_index`);

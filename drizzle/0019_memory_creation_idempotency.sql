CREATE TABLE `memory_creation_idempotency` (
	`idempotency_key` text PRIMARY KEY NOT NULL,
	`request_url` text NOT NULL,
	`created_at` integer NOT NULL
);

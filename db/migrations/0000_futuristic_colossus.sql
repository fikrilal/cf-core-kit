CREATE TABLE `idempotency_records` (
	`key` text PRIMARY KEY NOT NULL,
	`record` text NOT NULL,
	`expires_at` integer NOT NULL
);

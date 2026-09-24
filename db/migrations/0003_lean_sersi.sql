CREATE TABLE `stored_files` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`purpose` text NOT NULL,
	`status` text DEFAULT 'UPLOADING' NOT NULL,
	`bucket` text NOT NULL,
	`object_key` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`uploaded_at` integer,
	`deleted_at` integer,
	`trace_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stored_files_bucket_object_key_unique` ON `stored_files` (`bucket`,`object_key`);--> statement-breakpoint
CREATE INDEX `stored_files_owner_user_id_idx` ON `stored_files` (`owner_user_id`);--> statement-breakpoint
CREATE TABLE `user_account_deletion_audits` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text NOT NULL,
	`actor_session_id` text,
	`target_user_id` text NOT NULL,
	`action` text NOT NULL,
	`trace_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `user_account_deletion_audits_target_idx` ON `user_account_deletion_audits` (`target_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `user_account_deletion_audits_trace_idx` ON `user_account_deletion_audits` (`trace_id`);--> statement-breakpoint
CREATE TABLE `user_status_change_audits` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text NOT NULL,
	`actor_session_id` text,
	`target_user_id` text NOT NULL,
	`old_status` text NOT NULL,
	`new_status` text NOT NULL,
	`reason` text,
	`trace_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`target_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `user_status_change_audits_target_idx` ON `user_status_change_audits` (`target_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `user_status_change_audits_trace_idx` ON `user_status_change_audits` (`trace_id`);--> statement-breakpoint
DROP INDEX `sessions_revoked_at_idx`;--> statement-breakpoint
ALTER TABLE `sessions` ADD `push_platform` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `push_token` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `push_token_updated_at` integer;--> statement-breakpoint
ALTER TABLE `sessions` ADD `push_token_revoked_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_push_token_unique` ON `sessions` (`push_token`);--> statement-breakpoint
CREATE INDEX `sessions_expires_at_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
ALTER TABLE `users` ADD `deletion_requested_session_id` text;--> statement-breakpoint
ALTER TABLE `users` ADD `deletion_requested_trace_id` text;--> statement-breakpoint
ALTER TABLE `users` ADD `deleted_at` integer;
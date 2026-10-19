CREATE TABLE `photo_ai_index` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`photo_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`ai_tags` text DEFAULT '[]' NOT NULL,
	`caption` text,
	`search_text` text,
	`source_hash` text,
	`model_vision` text,
	`model_embedding` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text,
	`last_error` text,
	`lease_owner` text,
	`lease_expires_at` text,
	`indexed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `photo_asset`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_photo_ai_asset` ON `photo_ai_index` (`asset_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_photo_ai_photo` ON `photo_ai_index` (`photo_id`);--> statement-breakpoint
CREATE INDEX `idx_photo_ai_backfill` ON `photo_ai_index` (`status`,`next_attempt_at`,`lease_expires_at`);
CREATE TABLE `auth_account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` text,
	`refresh_token_expires_at` text,
	`scope` text,
	`password` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `auth_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_auth_account_provider` ON `auth_account` (`provider_id`,`account_id`);--> statement-breakpoint
CREATE INDEX `idx_auth_account_user` ON `auth_account` (`user_id`);--> statement-breakpoint
CREATE TABLE `auth_session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` text NOT NULL,
	`token` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`impersonated_by` text,
	`active_tenant_id` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`active_tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `auth_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_session_token_unique` ON `auth_session` (`token`);--> statement-breakpoint
CREATE TABLE `auth_user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`creem_customer_id` text,
	`had_trial` integer DEFAULT false NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`two_factor_enabled` integer DEFAULT false NOT NULL,
	`username` text,
	`display_username` text,
	`banned` integer DEFAULT false NOT NULL,
	`ban_reason` text,
	`ban_expires_at` text,
	`deletion_requested_at` text,
	`last_signed_in_at` text,
	`last_active_at` text,
	`last_active_surface` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_auth_user_email_normalized` ON `auth_user` (lower(trim("email")));--> statement-breakpoint
CREATE TABLE `auth_verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `comment_reaction` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`comment_id` text NOT NULL,
	`user_id` text NOT NULL,
	`reaction` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`comment_id`) REFERENCES `comment`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `auth_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_comment_reaction_user` ON `comment_reaction` (`tenant_id`,`comment_id`,`user_id`,`reaction`);--> statement-breakpoint
CREATE INDEX `idx_comment_reaction_comment` ON `comment_reaction` (`tenant_id`,`comment_id`);--> statement-breakpoint
CREATE TABLE `comment` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`photo_id` text NOT NULL,
	`user_id` text NOT NULL,
	`parent_id` text,
	`content` text NOT NULL,
	`status` text DEFAULT 'approved' NOT NULL,
	`user_agent` text,
	`client_ip` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `auth_user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `comment`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_comment_tenant_photo` ON `comment` (`tenant_id`,`photo_id`);--> statement-breakpoint
CREATE INDEX `idx_comment_parent` ON `comment` (`parent_id`);--> statement-breakpoint
CREATE INDEX `idx_comment_user` ON `comment` (`user_id`);--> statement-breakpoint
CREATE TABLE `photo_asset` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`photo_id` text NOT NULL,
	`storage_key` text NOT NULL,
	`storage_provider` text NOT NULL,
	`size` integer,
	`etag` text,
	`last_modified` text,
	`metadata_hash` text,
	`manifest_version` text DEFAULT 'v10' NOT NULL,
	`manifest` text NOT NULL,
	`sync_status` text DEFAULT 'pending' NOT NULL,
	`conflict_reason` text,
	`conflict_payload` text DEFAULT 'null',
	`synced_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_photo_asset_tenant_storage_key` ON `photo_asset` (`tenant_id`,`storage_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_photo_asset_tenant_photo_id` ON `photo_asset` (`tenant_id`,`photo_id`);--> statement-breakpoint
CREATE INDEX `idx_photo_asset_tenant_synced` ON `photo_asset` (`tenant_id`,`synced_at`);--> statement-breakpoint
CREATE TABLE `photo_sync_run` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`dry_run` integer DEFAULT false NOT NULL,
	`summary` text NOT NULL,
	`actions_count` integer DEFAULT 0 NOT NULL,
	`started_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`completed_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_photo_sync_run_tenant` ON `photo_sync_run` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `reactions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`ref_key` text NOT NULL,
	`reaction` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_reactions_tenant_ref_key` ON `reactions` (`tenant_id`,`ref_key`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`is_sensitive` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_settings_tenant_key` ON `settings` (`tenant_id`,`key`);--> statement-breakpoint
CREATE TABLE `system_setting` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`value` text DEFAULT 'null',
	`is_sensitive` integer DEFAULT false NOT NULL,
	`description` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_system_setting_key` ON `system_setting` (`key`);--> statement-breakpoint
CREATE TABLE `tenant_manifest_change` (
	`tenant_id` text NOT NULL,
	`revision` integer NOT NULL,
	`operation` text NOT NULL,
	`photo_id` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_tenant_manifest_change_revision` ON `tenant_manifest_change` (`tenant_id`,`revision`);--> statement-breakpoint
CREATE INDEX `idx_tenant_manifest_change_tenant_revision` ON `tenant_manifest_change` (`tenant_id`,`revision`);--> statement-breakpoint
CREATE TABLE `tenant_manifest_state` (
	`tenant_id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tenant_membership` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `auth_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_tenant_membership_tenant_user` ON `tenant_membership` (`tenant_id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_tenant_membership_active_owner` ON `tenant_membership` (`tenant_id`) WHERE "tenant_membership"."role" = 'owner' and "tenant_membership"."status" = 'active';--> statement-breakpoint
CREATE INDEX `idx_tenant_membership_user_status` ON `tenant_membership` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_tenant_membership_tenant_role_status` ON `tenant_membership` (`tenant_id`,`role`,`status`);--> statement-breakpoint
CREATE TABLE `tenant` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`plan_id` text DEFAULT 'free' NOT NULL,
	`storage_plan_id` text,
	`banned` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'inactive' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_tenant_slug` ON `tenant` (`slug`);
ALTER TABLE `daily_results` MODIFY COLUMN `tier` varchar(16);--> statement-breakpoint
ALTER TABLE `daily_results` ADD `category` varchar(32);--> statement-breakpoint
ALTER TABLE `daily_results` ADD `isOfficialPlay` int DEFAULT 0;
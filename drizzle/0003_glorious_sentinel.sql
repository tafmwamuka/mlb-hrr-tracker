CREATE TABLE `notifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`playerId` int NOT NULL,
	`playerName` varchar(128) NOT NULL,
	`statType` enum('hits','runs','rbi','slg') NOT NULL,
	`confidence` int,
	`message` text,
	`read` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `user_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`minConfidenceThreshold` int DEFAULT 75,
	`enableNotifications` int DEFAULT 1,
	`notifyHighConfidence` int DEFAULT 1,
	`notifyNewGames` int DEFAULT 0,
	`preferredStats` varchar(64) DEFAULT 'hits,runs,rbi,slg',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_settings_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `user_watchlist` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`playerId` int NOT NULL,
	`playerName` varchar(128) NOT NULL,
	`playerTeam` varchar(64) NOT NULL,
	`playerPosition` varchar(32),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_watchlist_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `user_favorites` MODIFY COLUMN `statType` enum('hits','runs','rbi','slg') NOT NULL;--> statement-breakpoint
ALTER TABLE `model_performance` ADD `slgCorrect` int DEFAULT 0;--> statement-breakpoint
ALTER TABLE `player_props` ADD `slgLine` text;--> statement-breakpoint
ALTER TABLE `player_props` ADD `slgConfidence` int;--> statement-breakpoint
ALTER TABLE `prop_predictions` ADD `slgPrediction` text;--> statement-breakpoint
ALTER TABLE `prop_predictions` ADD `slgReasoning` text;--> statement-breakpoint
ALTER TABLE `prop_predictions` ADD `slgActual` int;--> statement-breakpoint
ALTER TABLE `prop_predictions` ADD `slgCorrect` int;
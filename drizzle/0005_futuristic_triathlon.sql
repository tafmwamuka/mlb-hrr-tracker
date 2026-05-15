CREATE TABLE `ballparkpal_cache` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slateDate` varchar(16) NOT NULL,
	`matchupsJson` text NOT NULL,
	`matchupCount` int NOT NULL DEFAULT 0,
	`source` varchar(64) NOT NULL DEFAULT 'scheduled_task',
	`fetchedAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ballparkpal_cache_id` PRIMARY KEY(`id`)
);

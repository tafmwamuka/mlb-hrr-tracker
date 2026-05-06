CREATE TABLE `mlb_games` (
	`id` int AUTO_INCREMENT NOT NULL,
	`gameId` varchar(64) NOT NULL,
	`gameDate` timestamp NOT NULL,
	`homeTeam` varchar(64) NOT NULL,
	`awayTeam` varchar(64) NOT NULL,
	`homeTeamId` int,
	`awayTeamId` int,
	`status` varchar(32) NOT NULL DEFAULT 'scheduled',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `mlb_games_id` PRIMARY KEY(`id`),
	CONSTRAINT `mlb_games_gameId_unique` UNIQUE(`gameId`)
);
--> statement-breakpoint
CREATE TABLE `model_performance` (
	`id` int AUTO_INCREMENT NOT NULL,
	`date` timestamp NOT NULL,
	`totalPredictions` int DEFAULT 0,
	`hitsCorrect` int DEFAULT 0,
	`runsCorrect` int DEFAULT 0,
	`rbiCorrect` int DEFAULT 0,
	`overallHitRate` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `model_performance_id` PRIMARY KEY(`id`),
	CONSTRAINT `model_performance_date_unique` UNIQUE(`date`)
);
--> statement-breakpoint
CREATE TABLE `player_props` (
	`id` int AUTO_INCREMENT NOT NULL,
	`gameId` varchar(64) NOT NULL,
	`playerId` int NOT NULL,
	`playerName` varchar(128) NOT NULL,
	`playerTeam` varchar(64) NOT NULL,
	`hitsLine` text,
	`runsLine` text,
	`rbiLine` text,
	`hitsConfidence` int,
	`runsConfidence` int,
	`rbiConfidence` int,
	`parkFactor` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `player_props_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `prop_predictions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`gameId` varchar(64) NOT NULL,
	`playerId` int NOT NULL,
	`playerName` varchar(128) NOT NULL,
	`hitsPrediction` text,
	`runsPrediction` text,
	`rbiPrediction` text,
	`hitsReasoning` text,
	`runsReasoning` text,
	`rbiReasoning` text,
	`hitsActual` int,
	`runsActual` int,
	`rbiActual` int,
	`hitsCorrect` int,
	`runsCorrect` int,
	`rbiCorrect` int,
	`predictionDate` timestamp NOT NULL,
	`gameDate` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `prop_predictions_id` PRIMARY KEY(`id`)
);

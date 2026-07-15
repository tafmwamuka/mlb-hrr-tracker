CREATE TABLE `picks_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slate_date` varchar(10) NOT NULL,
	`pick_type` varchar(10) NOT NULL,
	`player_id` int NOT NULL,
	`player_name` varchar(100) NOT NULL,
	`team` varchar(10) NOT NULL,
	`opponent` varchar(10) NOT NULL,
	`game_pk` int NOT NULL,
	`prop_type` varchar(12) NOT NULL,
	`line` float NOT NULL,
	`book_odds` int,
	`model_prob` float NOT NULL,
	`edge` float,
	`tier` varchar(10) NOT NULL,
	`overall_score` float NOT NULL,
	`locked_at` datetime NOT NULL,
	`actual` float,
	`result` varchar(10) NOT NULL DEFAULT 'pending',
	`verified_at` datetime,
	`void_reason` varchar(200),
	CONSTRAINT `picks_history_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_pick` UNIQUE(`slate_date`,`player_id`,`prop_type`,`line`)
);
--> statement-breakpoint
CREATE INDEX `date_idx` ON `picks_history` (`slate_date`);
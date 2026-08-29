CREATE TABLE `reports` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `report_date` text NOT NULL,
  `generated_at` text NOT NULL,
  `status` text DEFAULT 'ready' NOT NULL,
  `payload` text NOT NULL
);

CREATE UNIQUE INDEX `reports_report_date_unique` ON `reports` (`report_date`);

CREATE TABLE `partner_snapshots` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `report_date` text NOT NULL,
  `partner_name` text NOT NULL,
  `news_title` text,
  `source_name` text,
  `source_url` text,
  `published_date` text,
  `previous_published_date` text,
  `change_status` text NOT NULL,
  `summary` text,
  `highlight` text
);

CREATE INDEX `partner_snapshots_report_date_idx`
ON `partner_snapshots` (`report_date`);

CREATE INDEX `partner_snapshots_partner_name_idx`
ON `partner_snapshots` (`partner_name`);

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const reports = sqliteTable("reports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  reportDate: text("report_date").notNull().unique(),
  generatedAt: text("generated_at").notNull(),
  status: text("status").notNull().default("ready"),
  payload: text("payload").notNull(),
});

export const partnerSnapshots = sqliteTable("partner_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  reportDate: text("report_date").notNull(),
  partnerName: text("partner_name").notNull(),
  newsTitle: text("news_title"),
  sourceName: text("source_name"),
  sourceUrl: text("source_url"),
  publishedDate: text("published_date"),
  previousPublishedDate: text("previous_published_date"),
  changeStatus: text("change_status").notNull(),
  summary: text("summary"),
  highlight: text("highlight"),
});

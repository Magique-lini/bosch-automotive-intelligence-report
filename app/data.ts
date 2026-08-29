import rawReports from "../data/reports.json";

export type NewsItem = {
  id: string;
  category: string;
  title: string;
  source: string;
  sourceUrl: string;
  publishedAt: string;
  detectedAt: string;
  summary: string;
  highlight: string;
  tags: string[];
  confidence: "高" | "中";
  isNew?: boolean;
};

export type PartnerNewsItem = {
  newsTitle: string;
  source: string;
  sourceUrl: string;
  publishedAt: string;
  summary: string;
  highlight: string;
  confidence: "高" | "中";
};

export type PartnerItem = {
  name: string;
  category: string;
  focus: string;
  priority: "活跃" | "关注" | "待定";
  status: "NEW" | "UPDATED" | "NO CHANGE" | "BASELINE";
  previousPublishedAt?: string;
  news: PartnerNewsItem[];
};

export type DailyReport = {
  generatedAt: string;
  industryNews: NewsItem[];
  partners: PartnerItem[];
  sourceAudit?: {
    incomplete?: boolean;
    publishable?: boolean;
  };
};

export const reportsByDate = rawReports as Record<string, DailyReport>;

export const archiveDates = Object.keys(reportsByDate)
  .filter((date) => {
    const report = reportsByDate[date];
    const partnersWithNews = report.partners.filter((partner) => partner.news.length > 0).length;
    return report.sourceAudit?.publishable !== false
      && report.industryNews.length >= 5
      && partnersWithNews >= Math.ceil(report.partners.length * 0.7);
  })
  .sort((a, b) => b.localeCompare(a))
  .slice(0, 20);

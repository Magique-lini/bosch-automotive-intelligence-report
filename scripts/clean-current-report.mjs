import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mergeIndustryNews } from "./report-quality.mjs";
import { isIndustryCategoryRelevant, normalizeIndustryAnalysis } from "./report-relevance.mjs";
import { getBlockedSourceReason } from "./source-verification.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportsPath = path.join(rootDir, "data", "reports.json");
const reports = JSON.parse(fs.readFileSync(reportsPath, "utf8"));
const reportDate = Object.keys(reports).sort((a, b) => b.localeCompare(a))[0];
const report = reports[reportDate];

if (!report?.sourceAudit?.pageVerification || !report?.sourceAudit?.publishable) {
  throw new Error("最新报告没有已通过页面验证的可发布基线，拒绝本地清洗。");
}

const beforeIndustry = report.industryNews.length;
const cleanedIndustry = mergeIndustryNews(
  [],
  report.industryNews
    .filter(isIndustryCategoryRelevant)
    .map(normalizeIndustryAnalysis)
);

let removedPartnerItems = 0;
const cleanedPartners = report.partners.map((partner) => ({
  ...partner,
  news: partner.news.filter((item) => {
    const reason = getBlockedSourceReason({ url: item.sourceUrl, title: item.newsTitle });
    if (reason) removedPartnerItems += 1;
    return !reason;
  })
}));

const categories = new Set(cleanedIndustry.map((item) => item.category)).size;
const partnersWithNews = cleanedPartners.filter((partner) => partner.news.length >= 1).length;
const partnersWithTwo = cleanedPartners.filter((partner) => partner.news.length >= 2).length;
if (cleanedIndustry.length < 7 || categories < 4 || partnersWithNews < 16 || partnersWithTwo < 9) {
  throw new Error(
    `清洗后未达质量门槛：行业 ${cleanedIndustry.length}/7，栏目 ${categories}/4，`
    + `有内容 Partner ${partnersWithNews}/16，至少两条 ${partnersWithTwo}/9。`
  );
}

reports[reportDate] = {
  ...report,
  generatedAt: new Date().toISOString(),
  sourceAudit: {
    ...report.sourceAudit,
    qualityVersion: 3,
    deterministicCleanup: true,
    cleanupRemovedIndustryItems: beforeIndustry - cleanedIndustry.length,
    cleanupRemovedPartnerItems: removedPartnerItems,
    warnings: [
      ...(report.sourceAudit.warnings || []),
      `已对当天已验证基线执行确定性质量清洗：行业移除 ${beforeIndustry - cleanedIndustry.length} 条，Partner 移除 ${removedPartnerItems} 条。`
    ]
  },
  industryNews: cleanedIndustry,
  partners: cleanedPartners
};

fs.writeFileSync(reportsPath, `${JSON.stringify(reports, null, 2)}\n`);
console.log(
  `完成 ${reportDate} 确定性清洗：${cleanedIndustry.length} 条行业新闻 / ${categories} 栏，`
  + `${partnersWithNews} 家 Partner 有内容，${partnersWithTwo} 家至少 2 条。`
);

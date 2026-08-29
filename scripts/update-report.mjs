import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  buildOpenAiRequestBody,
  buildZhipuRequestBody,
  extractJsonText,
  resolveAiConfig,
  resolveEndpoint
} from "./ai-provider.mjs";
import { findIndustryDeficits, mergeIndustryNews } from "./report-quality.mjs";
import {
  isIndustryCategoryRelevant,
  isPartnerCandidateRelevant,
  normalizeIndustryAnalysis
} from "./report-relevance.mjs";
import { requestIndustryRssCandidates } from "./rss-news-search.mjs";
import { createSourceVerifier, normalizeSourceUrl } from "./source-verification.mjs";
import { buildSearchQuery, requestZhipuWebSearch, selectRotatingPartners } from "./zhipu-web-search.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv(path.join(rootDir, ".env"));

const configPath = path.join(rootDir, "config", "scouting.json");
const reportsPath = path.join(rootDir, "data", "reports.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const reports = JSON.parse(fs.readFileSync(reportsPath, "utf8"));

let aiConfig;
try {
  aiConfig = resolveAiConfig(process.env);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const { provider, isZhipu, apiKey, model, baseUrl } = aiConfig;
const timezone = process.env.REPORT_TIMEZONE || config.timezone;
const retentionDays = Number(process.env.REPORT_RETENTION_DAYS || config.retentionDays);
const reportDate = process.env.REPORT_DATE || new Intl.DateTimeFormat("en-CA", {
  timeZone: timezone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

if (!apiKey) {
  const keyName = isZhipu ? "ZHIPU_API_KEY" : "OPENAI_API_KEY";
  console.error(`缺少 ${keyName}。请复制 .env.example 为 .env 后填写密钥。`);
  process.exit(1);
}

const earlierReportDate = Object.keys(reports)
  .filter((date) => date < reportDate)
  .sort((a, b) => b.localeCompare(a))[0];
// 同一天重跑时优先以当天已发布且验证过的报告为基线，避免调试重跑
// 丢掉当天仍有效的条目。首次生成当天报告时才回退到上一期。
const baselineReportDate = reports[reportDate] ? reportDate : earlierReportDate;
const previousReport = baselineReportDate ? reports[baselineReportDate] : null;
const previousByPartner = new Map((previousReport?.partners || []).map((item) => [item.name, item]));
const fromDate = new Date(`${reportDate}T00:00:00Z`);
fromDate.setUTCDate(fromDate.getUTCDate() - (config.industryWindowDays - 1));
const industryFromDate = fromDate.toISOString().slice(0, 10);
const partnerFromDateValue = new Date(`${reportDate}T00:00:00Z`);
partnerFromDateValue.setUTCDate(partnerFromDateValue.getUTCDate() - (config.partnerFreshnessDays - 1));
const partnerFromDate = partnerFromDateValue.toISOString().slice(0, 10);
const sourceVerifier = createSourceVerifier({ env: process.env });
const qualityWarnings = [];

function recordQualityWarning(message, error) {
  const detail = error?.message ? `${message}：${error.message}` : message;
  qualityWarnings.push(detail);
  console.warn(`警告：${detail}`);
}

function mergePartnerNews(primary = [], additions = []) {
  const merged = [];
  const seen = new Set();
  for (const item of [...primary, ...additions]) {
    const key = normalizeSourceUrl(item?.sourceUrl);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, config.partnerNewsMax);
}

async function mapSettledWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function runWorker() {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = { status: "fulfilled", value: await worker(items[index], index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runWorker));
  return results;
}

const newsItemSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "category", "title", "source", "sourceUrl", "publishedAt", "summary", "highlight", "tags", "confidence"],
  properties: {
    id: { type: "string" },
    category: { type: "string", enum: config.industryCategories },
    title: { type: "string" },
    source: { type: "string" },
    sourceUrl: { type: "string" },
    publishedAt: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    summary: { type: "string" },
    highlight: { type: "string" },
    tags: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 6 },
    confidence: { type: "string", enum: ["高", "中"] }
  }
};

const partnerNewsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["newsTitle", "source", "sourceUrl", "publishedAt", "summary", "highlight", "confidence"],
  properties: {
    newsTitle: { type: "string" },
    source: { type: "string" },
    sourceUrl: { type: "string" },
    publishedAt: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    summary: { type: "string" },
    highlight: { type: "string" },
    confidence: { type: "string", enum: ["高", "中"] }
  }
};

const partnerResultSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "news"],
  properties: {
    name: { type: "string", enum: config.partners.map((partner) => partner.name) },
    news: {
      type: "array",
      minItems: 0,
      maxItems: config.partnerNewsMax,
      items: partnerNewsSchema
    }
  }
};

const outputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["industryNews", "partners"],
  properties: {
    industryNews: {
      type: "array",
      minItems: Math.max(
        config.industryCategories.length * config.minimumIndustryItemsPerCategory,
        config.industryTargetMin
      ),
      maxItems: config.industryTargetMax,
      items: newsItemSchema
    },
    partners: {
      type: "array",
      minItems: config.partners.length,
      maxItems: config.partners.length,
      items: partnerResultSchema
    }
  }
};

let directSearchHealthy = !isZhipu;
let searchProAvailable = !isZhipu;
let directSearchCandidates = [];
let rotatingPartnerNames = [];
let directSearchCallCount = 0;
if (isZhipu) {
  const needsBaselineRebuild = previousReport?.sourceAudit?.directSearch !== true
    || previousReport?.sourceAudit?.qualityVersion !== 4;
  const selectedPartners = needsBaselineRebuild
    ? config.partners
    : selectRotatingPartners(
        config.partners,
        reportDate,
        Number(process.env.ZHIPU_PARTNER_SEARCH_BATCH_SIZE || 3)
      );
  rotatingPartnerNames = selectedPartners.map((partner) => partner.name);
  if (needsBaselineRebuild) {
    console.log("检测到历史报告尚未建立当前质量版本的 Search-Pro 基线，本次将为 21 家 Partner 分别检索。");
  }
  const industryQueryPool = [
      "汽车 L3 L4 认证 许可 法规",
      "ADAS 自动驾驶 量产 定点 车型",
      "汽车芯片 车规半导体 产能 涨价 交期",
      "智能座舱 舱驾融合 域控制器 中央计算",
      "汽车电驱 功率电子 热管理 制动 转向",
      "中国车企 欧洲 出口 工厂 本地化",
      "汽车供应链 短缺 召回 网络安全",
      "汽车零部件 Tier1 订单 定点 扩产",
      "智能网联汽车 数据 合规 强制标准",
      "汽车企业 CEO CTO 采购 研发 任命",
      "新能源车 销量 价格 产能 利润",
      "汽车软件 操作系统 AI 大模型 量产"
  ];
  const rotatingIndustryQueryCount = Number(process.env.ZHIPU_INDUSTRY_QUERY_COUNT || 8);
  const fixedIndustryQueries = industryQueryPool.slice(0, 4);
  const rotatingIndustryQueries = industryQueryPool.slice(4);
  const dayNumber = Math.floor(Date.parse(`${reportDate}T00:00:00Z`) / 86400000);
  const rotatingStart = dayNumber % rotatingIndustryQueries.length;
  const selectedIndustryQueries = [
    ...fixedIndustryQueries,
    ...Array.from(
      { length: Math.max(0, Math.min(rotatingIndustryQueryCount - fixedIndustryQueries.length, rotatingIndustryQueries.length)) },
      (_, index) => rotatingIndustryQueries[(rotatingStart + index) % rotatingIndustryQueries.length]
    )
  ];
  const searchRequests = [
    ...selectedIndustryQueries.map((query) => ({
      scope: "industry",
      partnerNames: [],
      query,
      // Search-Pro 对中文组合词使用 oneMonth 时经常错误地返回空集。
      // 先取全量结果，再由模型和后续页面验证严格执行行业日期窗口。
      recency: "noLimit",
      count: Number(process.env.ZHIPU_DIRECT_INDUSTRY_SEARCH_COUNT || 15)
    })),
    ...selectedPartners.map((partner) => ({
      scope: "partner",
      partnerNames: [partner.name],
      query: `${partner.searchQuery || partner.name || buildSearchQuery([partner.name])} ${partner.focus} 量产 合作 产品`.slice(0, 70),
      recency: "noLimit",
      count: Number(process.env.ZHIPU_DIRECT_PARTNER_SEARCH_COUNT || 8)
    }))
  ];
  directSearchCallCount = searchRequests.length;
  const runSearchRequest = (request) =>
    requestZhipuWebSearch({
        baseUrl,
        apiKey,
        query: request.query,
        searchEngine: process.env.ZHIPU_SEARCH_ENGINE || "search_pro",
        count: request.count,
        recency: request.recency,
        contentSize: process.env.ZHIPU_SEARCH_CONTENT_SIZE || "high",
        timeoutMs: Number(process.env.ZHIPU_DIRECT_SEARCH_TIMEOUT_MS || 60000)
      }).then((items) => items.map((item) => ({ ...item, scope: request.scope, partnerNames: request.partnerNames })));
  // 先用一个行业查询确认资源包可用。余额不足时立即熔断，避免其余几十个
  // Search-Pro 调用重复返回同一个 1113 错误。
  let settledSearches;
  try {
    const firstResult = await runSearchRequest(searchRequests[0]);
    const remainingResults = await mapSettledWithConcurrency(
      searchRequests.slice(1),
      Number(process.env.ZHIPU_DIRECT_SEARCH_CONCURRENCY || 4),
      runSearchRequest
    );
    settledSearches = [{ status: "fulfilled", value: firstResult }, ...remainingResults];
    searchProAvailable = true;
  } catch (error) {
    if (/code[^\d]*1113|余额不足|无可用资源包/i.test(error?.message || "")) {
      searchProAvailable = false;
      recordQualityWarning("Search-Pro 资源不可用，已熔断本次其余搜索请求", error);
      settledSearches = searchRequests.map(() => ({ status: "fulfilled", value: [] }));
    } else {
      const remainingResults = await mapSettledWithConcurrency(
        searchRequests.slice(1),
        Number(process.env.ZHIPU_DIRECT_SEARCH_CONCURRENCY || 4),
        runSearchRequest
      );
      settledSearches = [{ status: "rejected", reason: error }, ...remainingResults];
    }
  }
  for (let index = 0; index < settledSearches.length; index += 1) {
    const result = settledSearches[index];
    const request = searchRequests[index];
    if (result.status === "fulfilled") {
      directSearchCandidates.push(...result.value);
      console.log(`Search-Pro ${request.scope === "industry" ? "行业" : request.partnerNames[0]} 检索：返回 ${result.value.length} 条结构化候选来源。`);
    } else {
      recordQualityWarning(`Search-Pro ${request.scope === "industry" ? "行业" : request.partnerNames[0]} 检索失败`, result.reason);
    }
  }
  if (searchProAvailable && directSearchCandidates.filter((item) => item.scope === "industry").length < config.industryTargetMin) {
    const fallbackQueries = ["智能汽车 自动驾驶 芯片 零部件 最新", "汽车政策 车企人事 行业市场 最新"];
    const fallbackResults = await Promise.allSettled(
      fallbackQueries.map((query) => requestZhipuWebSearch({
        baseUrl,
        apiKey,
        query,
        searchEngine: process.env.ZHIPU_SEARCH_ENGINE || "search_pro",
        count: Number(process.env.ZHIPU_DIRECT_SEARCH_COUNT || 50),
        recency: "noLimit",
        contentSize: process.env.ZHIPU_SEARCH_CONTENT_SIZE || "high",
        timeoutMs: Number(process.env.ZHIPU_DIRECT_SEARCH_TIMEOUT_MS || 60000)
      }))
    );
    directSearchCallCount += fallbackQueries.length;
    for (const result of fallbackResults) {
      if (result.status === "fulfilled") {
        directSearchCandidates.push(...result.value.map((item) => ({ ...item, scope: "industry", partnerNames: [] })));
      } else {
        recordQualityWarning("Search-Pro 行业备用检索失败", result.reason);
      }
    }
    console.log(`Search-Pro 行业备用检索：累计取得 ${directSearchCandidates.filter((item) => item.scope === "industry").length} 条行业候选。`);
  }
  const timelySearchProIndustry = directSearchCandidates.filter(
    (item) => item.scope === "industry"
      && item.publishDate >= industryFromDate
      && item.publishDate <= reportDate
  );
  try {
    const rssResult = await requestIndustryRssCandidates({
      fromDate: industryFromDate,
      toDate: reportDate,
      perFeed: Number(process.env.INDUSTRY_RSS_ITEMS_PER_FEED || 20),
      timeoutMs: Number(process.env.INDUSTRY_RSS_TIMEOUT_MS || 30000)
    });
    for (const warning of rssResult.warnings) recordQualityWarning("行业 RSS 来源不可用", new Error(warning));
    directSearchCandidates = directSearchCandidates.filter((item) => item.scope !== "industry");
    directSearchCandidates.push(
      ...timelySearchProIndustry,
      ...rssResult.candidates.map((item) => ({ ...item, scope: "industry", partnerNames: [] }))
    );
    console.log(`行业 RSS 常规补充：取得 ${rssResult.candidates.length} 条 ${industryFromDate} 至 ${reportDate} 的候选来源。`);
  } catch (error) {
    recordQualityWarning("行业 RSS 常规补充失败", error);
  }
  directSearchCandidates = directSearchCandidates.filter((item) =>
    item.scope !== "partner"
      || !item.publishDate
      || (item.publishDate >= partnerFromDate && item.publishDate <= reportDate)
  );
  const seenCandidateUrls = new Set();
  directSearchCandidates = directSearchCandidates.filter((item) => {
    const key = `${item.scope}:${item.partnerNames.join(",")}:${normalizeSourceUrl(item.link)}`;
    if (!normalizeSourceUrl(item.link) || seenCandidateUrls.has(key)) return false;
    seenCandidateUrls.add(key);
    return true;
  });
  // Partner 搜索是轮换监测，某几家公司无近期结果不能阻断整份日报。
  directSearchHealthy = directSearchCandidates.some((item) => item.scope === "industry");
}

const partnerContext = config.partners.map((partner) => {
  const previous = previousByPartner.get(partner.name);
  return {
    name: partner.name,
    searchTerms: partner.searchTerms,
    currentBaselines: (previous?.news || [])
      .filter((item) => item.publishedAt >= partnerFromDate && item.publishedAt <= reportDate)
      .map((item) => ({
      newsTitle: item.newsTitle,
      sourceUrl: item.sourceUrl,
      source: item.source,
      publishedAt: item.publishedAt
    }))
  };
});

const directSearchContext = directSearchCandidates.map((item) => ({
  scope: item.scope,
  partnerNames: item.partnerNames,
  title: item.title,
  // 标题、URL、来源和日期足以让模型挑选；正文仅保留短摘要，避免 21 家
  // 候选的完整抓取内容挤满上下文并导致 FlashX 长时间思考或响应超时。
  content: String(item.content || "").replace(/\s+/g, " ").slice(0, 320),
  sourceUrl: item.link,
  source: item.media,
  publishedAt: item.publishDate
}));

const prompt = `
你是一名服务于汽车 Tier 1 业务团队的资深行业情报分析师。今天是 ${reportDate}，时区 ${timezone}。

任务一：搜索并生成“每日行业动态”。
- 新闻来源自身的发布日期必须在 ${industryFromDate} 至 ${reportDate} 之间。
- 目标返回 ${config.industryTargetMin}-${config.industryTargetMax} 条；五个固定栏目尽量每栏至少 ${config.minimumIndustryItemsPerCategory} 条。若“人事变动”没有真正重要事件，不得用普通任命凑数，应把名额用于其他高价值栏目。
- 不是简单凑数。优先收录会影响项目定点、芯片或零部件价格与交期、供应安全、量产节奏、合规认证、竞争格局或关键管理层的动态。
- 站在博世汽车业务视角排序：优先保留能触发客户跟进、供应风险评估、产品路线判断、定点机会识别或合规行动的新闻。普通新车上市、泛销量稿和无具体业务影响的宣传稿降级。
- 特别检查 L3/L4 认证许可、KBA/欧盟合规、智驾量产、汽车芯片涨价与产能信号，避免漏掉类似“Momenta 获德国 KBA 全境 L4 测试许可”的大新闻。
- 搜索源优先级：${config.preferredIndustrySources.join("；")}。
- 搜索主题：${config.industrySearchThemes.join("；")}。

任务二：为 21 家固定 Partner 各保留 0-${config.partnerNewsMax} 条“近期且与汽车业务相关”的有效动态，并按 publishedAt 从新到旧排列。
- Partner 新闻发布日期必须在 ${partnerFromDate} 至 ${reportDate} 之间。超过最近 ${config.partnerFreshnessDays} 天的旧闻绝对不能作为日报动态返回。
- 优先找比 currentBaselines 更新的官方或高可信来源；找不到近期可信内容时 news 返回空数组，禁止用多年旧闻凑数。
- 不能拿招聘、泛 ESG、获奖、与汽车无关的消费电子新闻填充。
- 21 家 Partner 必须一一返回且不可重复：${JSON.stringify(partnerContext)}。

统一质量要求：
- 以下 verifiedSearchCandidates 是 Search-Pro 直接返回的结构化候选来源：${JSON.stringify(directSearchContext)}。
- 新闻的 sourceUrl 必须逐字复制自 verifiedSearchCandidates.sourceUrl，或 Partner currentBaselines 中已存在的 sourceUrl；禁止推测、改写、拼接 URL。
- 标题、来源和发布日期必须与所选候选条目一致。候选结果不足时宁可返回较少条目，不得编造新闻或链接。
- 优先公司官网、监管机构、交易所和协会；媒体报道只能在没有一手来源或用于重大突发时使用。
- sourceUrl 必须是具体文章或可验证新闻列表页，不得编造链接。
- publishedAt 是来源页面的发布日期，不是抓取日期。
- summary 用 1–2 句概括事实；highlight 用 1 句说明对汽车 Tier 1 业务的潜在影响，清楚区分事实与推断。
- 删除重复事件；同一事件只保留信息最完整、来源最可靠的一条。
- 仅输出一个合法 JSON 对象。不要输出 Markdown 代码块、解释文字或思考过程。
${isZhipu ? `- 输出必须严格符合以下 JSON Schema；字段不可缺失，也不得增加 Schema 之外的字段：\n${JSON.stringify(outputSchema)}` : "- 输出必须符合接口提供的 JSON Schema。"}
`.trim();

const endpoint = isZhipu
  ? resolveEndpoint(baseUrl, "/chat/completions")
  : resolveEndpoint(baseUrl, "/responses");

async function requestStructuredJsonOnce(requestPrompt, schema, phase, { timeoutMs, progressIntervalMs }) {
  const requestBody = isZhipu
    ? buildZhipuRequestBody({
        env: process.env,
        model,
        prompt: requestPrompt,
        industryFromDate,
        reportDate,
        enableWebSearch: directSearchCandidates.length === 0
      })
    : buildOpenAiRequestBody({ env: process.env, model, prompt: requestPrompt, outputSchema: schema });

  let response;
  const startedAt = Date.now();
  console.log(`${phase}：已发送 API 请求，最长等待 ${Math.ceil(timeoutMs / 1000)} 秒。`);
  const progressTimer = progressIntervalMs > 0
    ? setInterval(() => {
        const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
        console.log(`${phase}：仍在等待 API 返回（已等待 ${elapsedSeconds} 秒）…`);
      }, progressIntervalMs)
    : null;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    throw new Error(`${phase}：${isZhipu ? "智谱" : "OpenAI"} API 连接失败（${endpoint}）：${error.cause?.message || error.message}`);
  } finally {
    if (progressTimer) clearInterval(progressTimer);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${phase}：${isZhipu ? "智谱" : "OpenAI"} API 请求失败 ${response.status}: ${body}`);
  }

  const payload = await response.json();
  const rawOutputText = isZhipu
    ? payload.choices?.[0]?.message?.content
    : (payload.output || [])
        .flatMap((item) => item.content || [])
        .find((item) => item.type === "output_text")?.text;
  const outputText = extractJsonText(rawOutputText);

  if (!outputText) {
    throw new Error(`${phase}：${isZhipu ? "智谱" : "OpenAI"} API 未返回结构化正文。response id: ${payload.id || payload.request_id || "unknown"}`);
  }

  try {
    return JSON.parse(outputText);
  } catch (error) {
    const preview = outputText.slice(0, 500).replace(/\s+/g, " ");
    throw new Error(`${phase}：${isZhipu ? "智谱" : "OpenAI"} 返回内容不是合法 JSON：${error.message}。内容开头：${preview}`);
  }
}

function shouldRetryAiRequest(error) {
  return !/API 请求失败 (?:400|401|403|404|429)\b/.test(error?.message || "");
}

async function requestStructuredJson(requestPrompt, schema, phase, options = {}) {
  const attempts = Number(options.attempts ?? process.env.AI_REQUEST_ATTEMPTS ?? 2);
  const retryDelayMs = Number(process.env.AI_RETRY_DELAY_MS || 1500);
  const timeoutMs = Number(options.timeoutMs ?? process.env.AI_REQUEST_TIMEOUT_MS ?? 300000);
  const progressIntervalMs = Number(process.env.AI_PROGRESS_INTERVAL_MS || 30000);
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 5) {
    throw new Error("AI_REQUEST_ATTEMPTS 必须是 1 至 5 之间的整数。");
  }
  if (!Number.isInteger(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 60000) {
    throw new Error("AI_RETRY_DELAY_MS 必须是 0 至 60000 之间的整数。");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 600000) {
    throw new Error("AI 请求超时必须是 1000 至 600000 毫秒之间的整数。");
  }
  if (!Number.isInteger(progressIntervalMs) || progressIntervalMs < 0 || progressIntervalMs > 60000) {
    throw new Error("AI_PROGRESS_INTERVAL_MS 必须是 0 至 60000 毫秒之间的整数。");
  }

  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const retryPrompt = attempt === 1
      ? requestPrompt
      : `${requestPrompt}\n\n重要：上一次返回的 JSON 不完整或请求临时失败。请重新生成完整结果，严格检查每个属性名后的冒号、字符串引号、逗号和所有闭合括号，只输出一个可被 JSON.parse 直接解析的 JSON 对象。`;
    try {
      return await requestStructuredJsonOnce(retryPrompt, schema, phase, { timeoutMs, progressIntervalMs });
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !shouldRetryAiRequest(error)) break;
      console.warn(`警告：${phase}第 ${attempt}/${attempts} 次请求失败，${retryDelayMs}ms 后重试：${error.message}`);
      if (retryDelayMs) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
  throw lastError;
}

console.log(`开始生成 ${reportDate} 日报：供应商 ${provider}，模型 ${model}，行业窗口 ${industryFromDate} 至 ${reportDate}，Partner 窗口 ${partnerFromDate} 至 ${reportDate}`);

let generated;
try {
  generated = await requestStructuredJson(prompt, outputSchema, "生成日报");
} catch (error) {
  if (!previousReport) throw error;
  recordQualityWarning("主日报请求在重试后仍失败，将以最近一期报告为基线继续验证和补搜", error);
  generated = {
    industryNews: Array.isArray(previousReport.industryNews) ? previousReport.industryNews : [],
    partners: config.partners.map((definition) => {
      const previous = previousByPartner.get(definition.name);
      return { name: definition.name, news: Array.isArray(previous?.news) ? previous.news : [] };
    })
  };
}
if (!Array.isArray(generated.industryNews)) {
  recordQualityWarning("生成日报：API 返回 JSON 缺少 industryNews 数组，将通过历史复用和补搜尽量恢复");
  generated.industryNews = [];
}
if (!Array.isArray(generated.partners)) {
  recordQualityWarning("生成日报：API 返回 JSON 缺少 partners 数组，将优先复用上期 Partner 内容");
  generated.partners = [];
}

const configuredPartnerNames = new Set(config.partners.map((partner) => partner.name));
const generatedByPartner = new Map();
for (const partner of generated.partners) {
  if (!configuredPartnerNames.has(partner?.name)) {
    recordQualityWarning(`忽略未配置的 Partner：${partner?.name || "unknown"}`);
    continue;
  }
  const existing = generatedByPartner.get(partner.name);
  if (existing) {
    recordQualityWarning(`Partner ${partner.name} 重复返回，已合并其新闻`);
    existing.news = mergePartnerNews(existing.news, Array.isArray(partner.news) ? partner.news : []);
  } else {
    generatedByPartner.set(partner.name, {
      name: partner.name,
      news: Array.isArray(partner.news) ? partner.news : []
    });
  }
}
generated.partners = config.partners.map((definition) => {
  const partner = generatedByPartner.get(definition.name);
  if (partner) return partner;
  recordQualityWarning(`Partner ${definition.name} 未在首轮结果中返回，将执行补搜或复用上期内容`);
  return { name: definition.name, news: [] };
});

const candidatesByUrl = new Map();
for (const candidate of directSearchCandidates) {
  const key = normalizeSourceUrl(candidate.link);
  const existing = candidatesByUrl.get(key) || [];
  existing.push(candidate);
  candidatesByUrl.set(key, existing);
}
const previousIndustryByUrl = new Map(
  (previousReport?.industryNews || []).map((item) => [normalizeSourceUrl(item.sourceUrl), item])
);

function bindIndustryToTrustedSources(items, phase) {
  const bound = [];
  let rejected = 0;
  for (const item of Array.isArray(items) ? items : []) {
    const key = normalizeSourceUrl(item?.sourceUrl);
    const candidate = (candidatesByUrl.get(key) || []).find((item) => item.scope === "industry");
    const previous = previousIndustryByUrl.get(key);
    if (candidate?.scope === "industry") {
      const trusted = {
        ...item,
        __searchProCandidate: true,
        title: candidate.title || item.title,
        source: candidate.media || item.source,
        sourceUrl: candidate.link,
        publishedAt: candidate.publishDate || item.publishedAt
      };
      if (isIndustryCategoryRelevant(trusted)) bound.push(normalizeIndustryAnalysis(trusted));
      else rejected += 1;
    } else if (previous) {
      if (isIndustryCategoryRelevant(previous)) bound.push(normalizeIndustryAnalysis(previous));
      else rejected += 1;
    } else {
      rejected += 1;
    }
  }
  if (rejected) recordQualityWarning(`${phase}：拒绝 ${rejected} 条非 Search-Pro 候选或非历史基线链接`);
  return bound;
}

function bindPartnerToTrustedSources(partnerName, items, phase) {
  const definition = config.partners.find((partner) => partner.name === partnerName);
  const ignoredTokens = new Set(["汽车", "最新", "latest", "automotive", "auto", "ai"]);
  const relevanceTokens = [partnerName, ...(definition?.searchTerms || [])]
    .flatMap((value) => String(value).toLowerCase().split(/[^\p{L}\p{N}+]+/u))
    .filter((token) => token.length >= 2 && !ignoredTokens.has(token));
  const matchesPartner = (candidate) => {
    const searchable = `${candidate?.title || ""} ${candidate?.content || ""}`.toLowerCase();
    return relevanceTokens.some((token) => searchable.includes(token))
      && isPartnerCandidateRelevant(candidate);
  };
  const previous = previousByPartner.get(partnerName);
  const previousByUrl = new Map((previous?.news || []).map((item) => [normalizeSourceUrl(item.sourceUrl), item]));
  const bound = [];
  let rejected = 0;
  for (const item of Array.isArray(items) ? items : []) {
    const key = normalizeSourceUrl(item?.sourceUrl);
    const candidate = (candidatesByUrl.get(key) || []).find(
      (entry) => entry.scope === "partner" && entry.partnerNames.includes(partnerName) && matchesPartner(entry)
    );
    const baseline = previousByUrl.get(key);
    if (candidate?.scope === "partner" && candidate.partnerNames.includes(partnerName)) {
      bound.push({
        ...item,
        __searchProCandidate: true,
        newsTitle: candidate.title || item.newsTitle,
        source: candidate.media || item.source,
        sourceUrl: candidate.link,
        publishedAt: candidate.publishDate || item.publishedAt
      });
    } else if (baseline) {
      bound.push(baseline);
    } else {
      rejected += 1;
    }
  }
  if (rejected) recordQualityWarning(`${phase}：拒绝 ${rejected} 条非 Search-Pro 候选或非历史基线链接`);
  return bound;
}

generated.industryNews = bindIndustryToTrustedSources(generated.industryNews, "首轮行业新闻来源绑定");
generated.industryNews = await sourceVerifier.verifyItems(generated.industryNews, {
  mode: "industry",
  industryFromDate,
  reportDate,
  phase: "首轮行业新闻验证"
});

for (const partner of generated.partners) {
  partner.news = bindPartnerToTrustedSources(partner.name, partner.news, `${partner.name} 首轮来源绑定`);
  partner.news = await sourceVerifier.verifyItems(partner.news, {
    mode: "partner",
    partnerFromDate,
    reportDate,
    phase: `${partner.name} 首轮来源验证`
  });
  partner.news.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

const beforeReuseCount = generated.industryNews.length;
const initialDeficits = findIndustryDeficits(
  generated.industryNews,
  config.industryCategories,
  config.minimumIndustryItemsPerCategory
);
for (const deficit of initialDeficits) {
  const historicalCandidates = (previousReport?.industryNews || [])
    .filter(
      (item) => item.category === deficit.category && item.publishedAt >= industryFromDate && item.publishedAt <= reportDate
    )
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const reusableCandidates = await sourceVerifier.verifyItems(historicalCandidates, {
    mode: "industry",
    industryFromDate,
    reportDate,
    phase: `复用上期行业新闻（${deficit.category}）`,
    allowTransientFailure: true
  });
  for (const candidate of reusableCandidates) {
    if (!isIndustryCategoryRelevant(candidate)) continue;
    generated.industryNews = mergeIndustryNews(generated.industryNews, [candidate]);
    const currentCount = generated.industryNews.filter((item) => item.category === deficit.category).length;
    if (currentCount >= config.minimumIndustryItemsPerCategory) break;
  }
}
if (generated.industryNews.length > beforeReuseCount) {
  console.log(`已复用上一期仍在 30 天窗口内的 ${generated.industryNews.length - beforeReuseCount} 条有效行业新闻。`);
}

const repairAttempts = Number(process.env.INDUSTRY_REPAIR_ATTEMPTS || 2);
if (!Number.isInteger(repairAttempts) || repairAttempts < 0 || repairAttempts > 5) {
  throw new Error("INDUSTRY_REPAIR_ATTEMPTS 必须是 0 至 5 之间的整数。");
}

let industryDeficits = findIndustryDeficits(
  generated.industryNews,
  config.industryCategories,
  config.minimumIndustryItemsPerCategory
);

for (let attempt = 1; industryDeficits.length && attempt <= repairAttempts; attempt += 1) {
  const requestedCounts = industryDeficits.map((item) => ({
    category: item.category,
    count: item.missing + 1
  }));
  const requestedTotal = requestedCounts.reduce((total, item) => total + item.count, 0);
  const missingCategories = requestedCounts.map((item) => item.category);
  const repairNewsItemSchema = {
    ...newsItemSchema,
    properties: {
      ...newsItemSchema.properties,
      category: { type: "string", enum: missingCategories }
    }
  };
  const repairSchema = {
    type: "object",
    additionalProperties: false,
    required: ["industryNews"],
    properties: {
      industryNews: {
        type: "array",
        minItems: requestedTotal,
        items: repairNewsItemSchema
      }
    }
  };
  const existingItems = generated.industryNews
    .filter((item) => missingCategories.includes(item.category))
    .map((item) => ({ category: item.category, title: item.title, sourceUrl: item.sourceUrl, publishedAt: item.publishedAt }));
  const repairSearchCandidates = directSearchContext.filter((item) => item.scope === "industry");
  if (isZhipu && !repairSearchCandidates.length) {
    recordQualityWarning("行业补搜已跳过：Search-Pro 没有返回可绑定的行业候选链接");
    break;
  }
  const repairPrompt = `
你是一名汽车行业情报分析师。今天是 ${reportDate}，请针对日报缺失栏目执行一次补充联网检索。

需要补充：${JSON.stringify(requestedCounts)}。
- 新闻原始发布日期必须在 ${industryFromDate} 至 ${reportDate} 之间。
- 只返回上述缺失栏目，不要返回其他栏目。
- 人事变动应关注汽车企业、零部件、芯片、智驾、座舱企业的董事长、CEO、总裁、CTO、采购、研发、智能驾驶等关键管理岗位任命或离职。
- 优先公司官网、监管机构、交易所、协会、盖世汽车、亿欧汽车、第一财经、财新、新华网和路透社。
- 不得重复以下已有新闻：${JSON.stringify(existingItems)}。
- 只能从以下 Search-Pro 结构化结果中选择，sourceUrl 必须逐字复制：${JSON.stringify(repairSearchCandidates)}。
- sourceUrl 必须是具体且可验证的原文链接；publishedAt 必须是来源发布日期。
- 仅输出合法 JSON，不要输出 Markdown 或说明文字。
${isZhipu ? `- 严格符合以下 JSON Schema：\n${JSON.stringify(repairSchema)}` : "- 输出必须符合接口提供的 JSON Schema。"}
  `.trim();

  console.log(`行业栏目不足，执行第 ${attempt}/${repairAttempts} 次补充检索：${industryDeficits.map((item) => `${item.category} 缺 ${item.missing} 条`).join("；")}`);
  let repaired;
  try {
    repaired = await requestStructuredJson(
      repairPrompt,
      repairSchema,
      `补充行业栏目（第 ${attempt} 次）`,
      { attempts: 1, timeoutMs: Number(process.env.AI_REPAIR_REQUEST_TIMEOUT_MS || 120000) }
    );
  } catch (error) {
    recordQualityWarning(`补充行业栏目（第 ${attempt} 次）失败，已跳过本次结果`, error);
    continue;
  }
  if (!Array.isArray(repaired.industryNews)) {
    recordQualityWarning(`补充行业栏目（第 ${attempt} 次）：API 返回 JSON 缺少 industryNews 数组，已跳过本次结果`);
    continue;
  }
  const boundIndustryRepairs = bindIndustryToTrustedSources(
    repaired.industryNews,
    `补充行业栏目（第 ${attempt} 次）来源绑定`
  );
  const verifiedRepairs = await sourceVerifier.verifyItems(boundIndustryRepairs, {
    mode: "industry",
    industryFromDate,
    reportDate,
    phase: `补充行业栏目（第 ${attempt} 次）来源验证`
  });
  const eligibleRepairs = verifiedRepairs
    .filter(
      (item) => missingCategories.includes(item.category)
        && item.publishedAt >= industryFromDate
        && item.publishedAt <= reportDate
        && isIndustryCategoryRelevant(item)
    )
    .map(normalizeIndustryAnalysis);
  generated.industryNews = mergeIndustryNews(generated.industryNews, eligibleRepairs);
  industryDeficits = findIndustryDeficits(
    generated.industryNews,
    config.industryCategories,
    config.minimumIndustryItemsPerCategory
  );
}

const partnerRepairAttempts = Number(process.env.PARTNER_REPAIR_ATTEMPTS || 1);
if (!Number.isInteger(partnerRepairAttempts) || partnerRepairAttempts < 0 || partnerRepairAttempts > 5) {
  throw new Error("PARTNER_REPAIR_ATTEMPTS 必须是 0 至 5 之间的整数。");
}

for (const partner of generated.partners) {
  partner.news = mergePartnerNews(partner.news, []);
  const partnerSearchCandidates = directSearchContext.filter(
    (item) => item.scope === "partner" && item.partnerNames.includes(partner.name)
  );

  for (let attempt = 1; partner.news.length < config.partnerNewsMin && attempt <= partnerRepairAttempts; attempt += 1) {
    if (isZhipu && !partnerSearchCandidates.length) {
      if (attempt === 1) {
        console.log(`${partner.name} 本日不在 Partner 轮换搜索批次中，直接复用上期已验证基线。`);
      }
      break;
    }
    const repairPartnerSchema = {
      type: "object",
      additionalProperties: false,
      required: ["name", "news"],
      properties: {
        name: { type: "string", enum: [partner.name] },
        news: {
          type: "array",
          minItems: 0,
          maxItems: config.partnerNewsMax,
          items: partnerNewsSchema
        }
      }
    };
    const definition = config.partners.find((item) => item.name === partner.name);
    const existingItems = partner.news.map((item) => ({
      newsTitle: item.newsTitle,
      sourceUrl: item.sourceUrl,
      publishedAt: item.publishedAt
    }));
    const partnerRepairPrompt = `
你是汽车 Tier 1 行业情报分析师。今天是 ${reportDate}，请为 Partner“${partner.name}”重新执行一次联网检索。
- 公司定义与关注点：${JSON.stringify(definition)}。
- 返回 0-${config.partnerNewsMax} 条真实存在、与汽车业务直接相关、发布日期在 ${partnerFromDate} 至 ${reportDate} 的动态。
- 如果候选中没有满足日期和质量条件的内容，news 返回空数组；不得使用更早旧闻凑数。
- sourceUrl 必须是可打开的具体新闻或公告页，不得使用首页、搜索页、栏目列表页或编造链接。
- 排除招聘、职位、CSDN、泛 ESG/CSR、普通获奖、SEO 文章和与汽车无关的内容。
- 优先公司官网、监管机构、交易所和行业协会的具体文章。
- 不得重复以下已通过验证的项目：${JSON.stringify(existingItems)}。
- 只能从以下 Search-Pro 结构化结果中选择，sourceUrl 必须逐字复制：${JSON.stringify(partnerSearchCandidates)}。
- publishedAt 必须使用来源页面的实际发布日期。
- 仅输出合法 JSON，不要输出 Markdown 或说明。
${isZhipu ? `- 严格符合以下 JSON Schema：\n${JSON.stringify(repairPartnerSchema)}` : "- 输出必须符合接口提供的 JSON Schema。"}
    `.trim();

    console.log(`${partner.name} 通过验证的新闻只有 ${partner.news.length} 条，执行第 ${attempt}/${partnerRepairAttempts} 次补搜。`);
    let repairedPartner;
    try {
      repairedPartner = await requestStructuredJson(
        partnerRepairPrompt,
        repairPartnerSchema,
        `${partner.name} 补搜（第 ${attempt} 次）`,
        { attempts: 1, timeoutMs: Number(process.env.AI_REPAIR_REQUEST_TIMEOUT_MS || 120000) }
      );
    } catch (error) {
      recordQualityWarning(`${partner.name} 补搜（第 ${attempt} 次）失败，已跳过本次结果`, error);
      continue;
    }
    if (repairedPartner?.name !== partner.name || !Array.isArray(repairedPartner?.news)) {
      recordQualityWarning(`${partner.name} 补搜（第 ${attempt} 次）：API 返回的 Partner 名称或 news 数组无效，已跳过本次结果`);
      continue;
    }
    const boundPartnerRepairs = bindPartnerToTrustedSources(
      partner.name,
      repairedPartner.news,
      `${partner.name} 补搜（第 ${attempt} 次）来源绑定`
    );
    const verifiedPartnerRepairs = await sourceVerifier.verifyItems(boundPartnerRepairs, {
      mode: "partner",
      partnerFromDate,
      reportDate,
      phase: `${partner.name} 补搜（第 ${attempt} 次）来源验证`
    });
    partner.news = mergePartnerNews(partner.news, verifiedPartnerRepairs);
  }

  if (partner.news.length < config.partnerNewsMin) {
    const previous = previousByPartner.get(partner.name);
    const verifiedPreviousNews = await sourceVerifier.verifyItems(previous?.news || [], {
      mode: "partner",
      partnerFromDate,
      reportDate,
      phase: `${partner.name} 复用上期 Partner 新闻`,
      allowTransientFailure: true
    });
    partner.news = mergePartnerNews(partner.news, verifiedPreviousNews);
  }

  if (partner.news.length < config.partnerNewsMin || partner.news.length > config.partnerNewsMax) {
    recordQualityWarning(`${partner.name} 在最近 ${config.partnerFreshnessDays} 天窗口内有 ${partner.news.length} 条有效动态，未达到 ${config.partnerNewsMin}-${config.partnerNewsMax} 条监测目标`);
  }
}

if (industryDeficits.length) {
  recordQualityWarning(`补充检索后行业栏目仍不足：${industryDeficits.map((item) => `“${item.category}”只有 ${item.count} 条`).join("；")}`);
}

const configByPartner = new Map(config.partners.map((partner) => [partner.name, partner]));
const partners = generated.partners.map((item) => {
  const definition = configByPartner.get(item.name);
  const previous = previousByPartner.get(item.name);
  const latest = item.news[0];
  const previousLatest = previous?.news?.[0];
  let status = "BASELINE";
  let previousPublishedAt;

  if (!latest && previousLatest) {
    status = "NO CHANGE";
  } else if (latest && previousLatest) {
    const sameSource = previousLatest.sourceUrl === latest.sourceUrl;
    const sameDate = previousLatest.publishedAt === latest.publishedAt;
    const sameTitle = previousLatest.newsTitle === latest.newsTitle;
    if (sameSource && sameDate && sameTitle) {
      status = "NO CHANGE";
    } else if (latest.publishedAt > previousLatest.publishedAt) {
      status = "NEW";
      previousPublishedAt = previousLatest.publishedAt;
    } else {
      status = "UPDATED";
      previousPublishedAt = previousLatest.publishedAt;
    }
  }

  return {
    name: item.name,
    category: definition.category,
    focus: definition.focus,
    priority: definition.priority,
    status,
    ...(previousPublishedAt ? { previousPublishedAt } : {}),
    news: item.news
  };
});

const previousIndustryUrls = new Set((previousReport?.industryNews || []).map((item) => item.sourceUrl));
const industryNews = generated.industryNews
  .filter((item) => item.publishedAt >= industryFromDate && item.publishedAt <= reportDate)
  .map((item) => ({
    ...item,
    detectedAt: reportDate,
    isNew: !previousIndustryUrls.has(item.sourceUrl)
  }));

const totalPartnerNews = partners.reduce((total, partner) => total + partner.news.length, 0);
if (!industryNews.length && !totalPartnerNews) {
  throw new Error("本次生成没有任何通过验证的行业或 Partner 新闻，为避免写入空报告，旧报告未被覆盖。");
}

const coveredIndustryCategories = new Set(industryNews.map((item) => item.category)).size;
const partnersWithNews = partners.filter((partner) => partner.news.length >= 1).length;
const partnersMeetingTarget = partners.filter((partner) => partner.news.length >= config.partnerNewsMin).length;
const minimumIndustryTotal = Math.max(10, config.industryTargetMin - 3);
const minimumCoveredCategories = Math.max(1, config.industryCategories.length - 1);
const publishable = directSearchHealthy
  && industryNews.length >= minimumIndustryTotal
  && coveredIndustryCategories >= minimumCoveredCategories;

if (!publishable) {
  throw new Error(
    `本期结果未达发布门槛，已保留上一份合格日报：`
    + `检索来源=${directSearchHealthy ? "正常" : "异常"}（Search-Pro=${searchProAvailable ? "可用" : "不可用"}）；`
    + `行业新闻 ${industryNews.length}/${minimumIndustryTotal} 条；`
    + `行业栏目 ${coveredIndustryCategories}/${minimumCoveredCategories} 个；`
    + `近 ${config.partnerFreshnessDays} 天有新闻 Partner ${partnersWithNews} 家；`
    + `达到 ${config.partnerNewsMin} 条的 Partner ${partnersMeetingTarget} 家。`
  );
}

reports[reportDate] = {
  generatedAt: new Date().toISOString(),
  sourceAudit: {
    qualityVersion: 4,
    industryWindowDays: config.industryWindowDays,
    partnerFreshnessDays: config.partnerFreshnessDays,
    partnerFromDate,
    provider,
    model,
    pageVerification: true,
    directSearch: searchProAvailable,
    rssSearch: directSearchCandidates.some((item) => item.scope === "industry" && item.media !== ""),
    publishable: true,
    directSearchCalls: directSearchCallCount,
    directSearchCandidates: directSearchCandidates.length,
    rotatingPartnerNames,
    attempts: sourceVerifier.stats.attempts,
    accepted: sourceVerifier.stats.accepted,
    rejected: sourceVerifier.stats.rejected,
    carriedForwardOnTransientFailure: sourceVerifier.stats.carriedForward,
    cacheHits: sourceVerifier.stats.cacheHits,
    rejectionReasons: sourceVerifier.stats.reasons,
    incomplete: qualityWarnings.length > 0,
    warnings: qualityWarnings
  },
  industryNews,
  partners
};

const retainedDates = Object.keys(reports).sort((a, b) => b.localeCompare(a)).slice(0, retentionDays);
const retainedReports = Object.fromEntries(retainedDates.map((date) => [date, reports[date]]));
fs.writeFileSync(reportsPath, `${JSON.stringify(retainedReports, null, 2)}\n`);

console.log(`完成：${industryNews.length} 条行业新闻，${partners.length} 家 Partner / ${partners.reduce((total, partner) => total + partner.news.length, 0)} 条 Partner 动态，保留 ${retainedDates.length}/${retentionDays} 期。`);
console.log(`来源验证：实际访问 ${sourceVerifier.stats.attempts} 个 URL，通过 ${sourceVerifier.stats.accepted} 次，淘汰 ${sourceVerifier.stats.rejected} 次，缓存命中 ${sourceVerifier.stats.cacheHits} 次。`);
if (qualityWarnings.length) {
  console.warn(`本期日报已保存，但有 ${qualityWarnings.length} 项质量警告；详情已写入 sourceAudit.warnings。`);
}

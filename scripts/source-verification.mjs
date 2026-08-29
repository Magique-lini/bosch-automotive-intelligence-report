const blockedHosts = [
  "liepin.com",
  "zhipin.com",
  "zhaopin.com",
  "51job.com",
  "jobui.com",
  "lagou.com",
  "indeed.com",
  "glassdoor.com",
  "monster.com",
  "careerbuilder.com",
  "simplyhired.com",
  "talent.com",
  "jobstreet.com",
  "jobsdb.com",
  "workdayjobs.com",
  "csdn.net",
  "hupu.com"
];

const blockedTitleKeywords = [
  "招聘",
  "诚聘",
  "人才招聘",
  "校园招聘",
  "社会招聘",
  "招聘岗位",
  "招聘职位",
  "职位招聘",
  "加入我们",
  "job opening",
  "job openings",
  "career opportunity",
  "career opportunities",
  "we are hiring",
  "vacancy",
  "vacancies",
  "可持续发展报告",
  "社会责任报告",
  "企业社会责任报告",
  "esg report",
  "csr report",
  "sustainability report",
  "获奖",
  "荣获",
  "入选毕马威",
  "领先汽车科技50",
  "领先汽车科技 50",
  "百强创新机构",
  "百科",
  "专利",
  "职称评审",
  "评审通过人员名单",
  "名单公示",
  "震惊",
  "担保",
  "独角兽榜",
  "会议前瞻",
  "精选会议",
  "碰瓷"
];

const blockedUrlKeywords = [
  "/job/",
  "/jobs/",
  "/job-",
  "/careers/",
  "/career/",
  "/recruit/",
  "/recruitment/",
  "/join-us/",
  "/joinus/"
];

function positiveInteger(value, fallback, name) {
  const parsed = Number(value || fallback);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} 必须是正整数。`);
  return parsed;
}

function decodeHtmlEntities(value) {
  if (!value) return "";
  return String(value)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => {
      try { return String.fromCodePoint(Number(code)); } catch { return ""; }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      try { return String.fromCodePoint(parseInt(code, 16)); } catch { return ""; }
    });
}

function cleanText(value) {
  return decodeHtmlEntities(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function cleanUrl(value) {
  if (typeof value !== "string") return "";
  const url = value.trim();
  return /^https?:\/\//i.test(url) ? url : "";
}

export function normalizeSourceUrl(value) {
  const cleaned = cleanUrl(value);
  if (!cleaned) return "";
  try {
    const url = new URL(cleaned);
    url.hash = "";
    for (const name of [...url.searchParams.keys()]) {
      if (/^(utm_.+|spm|from|source)$/i.test(name)) url.searchParams.delete(name);
    }
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch {
    return "";
  }
}

function getHostname(value) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

export function getBlockedSourceReason({ url, title }) {
  const cleanedUrl = cleanUrl(url);
  const cleanedTitle = cleanText(title).toLowerCase();
  if (!cleanedUrl) return "invalid_url";
  const hostname = getHostname(cleanedUrl);
  if (blockedHosts.some((host) => hostname === host || hostname.endsWith(`.${host}`))) {
    return `blocked_host:${hostname}`;
  }
  if (blockedTitleKeywords.some((keyword) => cleanedTitle.includes(keyword.toLowerCase()))) {
    return "blocked_title";
  }
  const lowerUrl = cleanedUrl.toLowerCase();
  if (blockedUrlKeywords.some((keyword) => lowerUrl.includes(keyword))) return "blocked_url";
  return "";
}

function parseHtmlAttributes(tag) {
  const result = {};
  const regex = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match;
  while ((match = regex.exec(tag))) {
    result[match[1].toLowerCase()] = decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return result;
}

export function extractPageTitle(html) {
  const metaTags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of metaTags) {
    const attrs = parseHtmlAttributes(tag);
    const key = (attrs.property || attrs.name || "").toLowerCase();
    if (["og:title", "twitter:title"].includes(key) && attrs.content) return cleanText(attrs.content);
  }
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1?.[1]) return cleanText(h1[1]);
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return title?.[1] ? cleanText(title[1]) : "";
}

function normalizeDateCandidate(raw) {
  if (!raw) return "";
  const value = cleanText(raw);
  const match = value.match(/(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/) ||
    value.match(/(20\d{2})年\s*(\d{1,2})月\s*(\d{1,2})日/);
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function htmlToText(html) {
  if (!html) return "";
  const article = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  const source = article?.[1] || main?.[1] || html;
  return decodeHtmlEntities(source
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, " ")
    .replace(/<form\b[^>]*>[\s\S]*?<\/form>/gi, " ")
    .replace(/<(?:p|div|section|article|h1|h2|h3|li|br|tr|td)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function extractJsonLdArticleText(html) {
  const scripts = html.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  const parts = [];
  const walk = (value) => {
    if (!value) return;
    if (Array.isArray(value)) return value.forEach(walk);
    if (typeof value !== "object") return;
    for (const key of ["articleBody", "description", "headline"]) {
      if (typeof value[key] === "string") parts.push(value[key]);
    }
    Object.values(value).filter((child) => child && typeof child === "object").forEach(walk);
  };
  for (const script of scripts) {
    const body = script.replace(/^[\s\S]*?>/, "").replace(/<\/script>\s*$/i, "").trim();
    try { walk(JSON.parse(body)); } catch { /* Ignore non-standard JSON-LD. */ }
  }
  return cleanText(parts.join(" "));
}

export function extractPublishedDate(html) {
  const candidates = [];
  const dateMetaNames = new Set([
    "article:published_time", "article:published", "datepublished", "date", "pubdate",
    "publishdate", "publication_date", "publicationdate", "publish_time", "published_time",
    "dc.date", "dc.date.issued", "sailthru.date"
  ]);
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attrs = parseHtmlAttributes(tag);
    const key = (attrs.property || attrs.name || attrs.itemprop || "").toLowerCase();
    if (dateMetaNames.has(key) && attrs.content) candidates.push(attrs.content);
  }
  const jsonRegexes = [
    /"datePublished"\s*:\s*"([^"]+)"/gi,
    /"publishTime"\s*:\s*"([^"]+)"/gi,
    /"publishDate"\s*:\s*"([^"]+)"/gi,
    /"publishedAt"\s*:\s*"([^"]+)"/gi,
    /"publicationDate"\s*:\s*"([^"]+)"/gi,
    /"createdAt"\s*:\s*"([^"]+)"/gi
  ];
  for (const regex of jsonRegexes) {
    let match;
    while ((match = regex.exec(html))) candidates.push(match[1]);
  }
  for (const tag of html.match(/<time\b[^>]*>/gi) || []) {
    const attrs = parseHtmlAttributes(tag);
    if (attrs.datetime) candidates.push(attrs.datetime);
  }
  const visibleText = htmlToText(html).slice(0, 5000);
  for (const regex of [
    /(?:发布时间|发布日期|发布于|更新于|发表时间|时间)\s*[:：]?\s*((?:20\d{2})[-/.年]\s*\d{1,2}[-/.月]\s*\d{1,2}日?)/i,
    /(?:Published|Publication Date|Publish Date|Posted|Updated)\s*[:：]?\s*((?:20\d{2})[-/.]\d{1,2}[-/.]\d{1,2})/i,
    /(20\d{2}年\s*\d{1,2}月\s*\d{1,2}日)/,
    /(20\d{2}[-/.]\d{1,2}[-/.]\d{1,2})/
  ]) {
    const match = visibleText.match(regex);
    if (match?.[1]) candidates.push(match[1]);
  }
  for (const candidate of candidates) {
    const normalized = normalizeDateCandidate(candidate);
    if (normalized) return normalized;
  }
  return "";
}

export function looksLikeListingPage({ url, title, html }) {
  let parsed;
  try { parsed = new URL(url); } catch { return true; }
  const pathname = parsed.pathname.toLowerCase().replace(/\/+$/, "");
  if (!pathname || pathname === "/") return true;
  const titleLower = cleanText(title).toLowerCase();
  const markers = ["新闻中心", "新闻列表", "资讯中心", "press center", "news center", "newsroom", "search results", "搜索结果", "招聘", "careers", "jobs"];
  if (markers.some((marker) => titleLower === marker || titleLower.startsWith(`${marker} `))) return true;
  const exactListPaths = ["/news", "/press", "/media", "/newsroom", "/search", "/category", "/tag", "/careers", "/jobs"];
  if (!/<article\b/i.test(html) && exactListPaths.includes(pathname)) return true;
  return /\/(?:search|tag|category)\//i.test(pathname);
}

function detectCharset(contentType, buffer) {
  const headerMatch = String(contentType || "").match(/charset\s*=\s*["']?([^;"'\s]+)/i);
  let charset = headerMatch?.[1]?.toLowerCase();
  if (!charset) {
    const preview = Buffer.from(buffer).subarray(0, 4096).toString("ascii");
    charset = preview.match(/charset\s*=\s*["']?\s*([a-zA-Z0-9_-]+)/i)?.[1]?.toLowerCase();
  }
  return ["gbk", "gb2312"].includes(charset) ? "gb18030" : (charset || "utf-8");
}

function decodePageBuffer(buffer, contentType) {
  try { return new TextDecoder(detectCharset(contentType, buffer)).decode(buffer); }
  catch { return new TextDecoder("utf-8").decode(buffer); }
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function runWorker() {
    while (cursor < items.length) {
      const index = cursor++;
      try { results[index] = await worker(items[index], index); }
      catch (error) { results[index] = { ok: false, reason: `worker_error:${error.message}` }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(concurrency, 1), items.length) }, runWorker));
  return results;
}

export function createSourceVerifier({ env = process.env, fetchImpl = globalThis.fetch, logger = console } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("当前 Node.js 环境不支持 fetch，请使用 Node.js 22.13 或更高版本。");
  const timeoutMs = positiveInteger(env.PAGE_FETCH_TIMEOUT_MS, 20000, "PAGE_FETCH_TIMEOUT_MS");
  const minTextChars = positiveInteger(env.PAGE_MIN_TEXT_CHARS, 250, "PAGE_MIN_TEXT_CHARS");
  const concurrency = positiveInteger(env.PAGE_FETCH_CONCURRENCY, 4, "PAGE_FETCH_CONCURRENCY");
  const maxPageBytes = positiveInteger(env.PAGE_MAX_BYTES, 5 * 1024 * 1024, "PAGE_MAX_BYTES");
  const cache = new Map();
  const stats = { attempts: 0, accepted: 0, rejected: 0, carriedForward: 0, cacheHits: 0, reasons: {} };

  async function fetchAndInspect(item) {
    const title = item?.title || item?.newsTitle || "";
    const requestedUrl = cleanUrl(item?.sourceUrl);
    const blockedReason = getBlockedSourceReason({ url: requestedUrl, title });
    if (blockedReason) return { ok: false, reason: blockedReason };
    const key = normalizeSourceUrl(requestedUrl);
    if (cache.has(key)) {
      stats.cacheHits += 1;
      return cache.get(key);
    }
    const pending = (async () => {
      stats.attempts += 1;
      let response;
      try {
        response = await fetchImpl(requestedUrl, {
          method: "GET",
          redirect: "follow",
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"
          },
          signal: AbortSignal.timeout(timeoutMs)
        });
      } catch (error) {
        return { ok: false, reason: `fetch_error:${error.cause?.message || error.message}` };
      }
      if (!response.ok) return { ok: false, reason: `http_${response.status}` };
      const contentType = response.headers.get("content-type") || "";
      const finalUrl = response.url || requestedUrl;
      if (
        /application\/pdf/i.test(contentType)
        && item?.__searchProCandidate
        && /^\d{4}-\d{2}-\d{2}$/.test(item.publishedAt || "")
      ) {
        return { ok: true, requestedUrl, finalUrl, pageTitle: title, publishedAt: item.publishedAt };
      }
      if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
        return { ok: false, reason: `unsupported_content_type:${contentType}` };
      }
      const contentLength = Number(response.headers.get("content-length") || 0);
      if (contentLength > maxPageBytes) return { ok: false, reason: "page_too_large" };
      let buffer;
      try { buffer = await response.arrayBuffer(); }
      catch (error) { return { ok: false, reason: `read_error:${error.message}` }; }
      if (buffer.byteLength > maxPageBytes) return { ok: false, reason: "page_too_large" };
      const html = decodePageBuffer(buffer, contentType);
      const pageTitle = extractPageTitle(html) || title;
      const finalBlockedReason = getBlockedSourceReason({ url: finalUrl, title: pageTitle });
      if (finalBlockedReason) return { ok: false, reason: finalBlockedReason };
      if (looksLikeListingPage({ url: finalUrl, title: pageTitle, html })) {
        return { ok: false, reason: "listing_or_homepage" };
      }
      let pageText = htmlToText(html);
      if (pageText.length < minTextChars) {
        const jsonLdText = extractJsonLdArticleText(html);
        if (jsonLdText.length > pageText.length) pageText = jsonLdText;
      }
      if (pageText.length < minTextChars) {
        return { ok: false, reason: `page_text_too_short:${pageText.length}`, finalUrl };
      }
      const publishedAt = extractPublishedDate(html);
      if (!publishedAt) return { ok: false, reason: "published_date_missing", finalUrl };
      return { ok: true, requestedUrl, finalUrl, pageTitle, publishedAt };
    })();
    cache.set(key, pending);
    return pending;
  }

  async function verifyItems(
    items,
    { mode, industryFromDate, partnerFromDate, reportDate, phase = "来源验证", allowTransientFailure = false } = {}
  ) {
    if (!Array.isArray(items) || !items.length) return [];
    const unique = [];
    const seen = new Set();
    for (const item of items) {
      const key = normalizeSourceUrl(item?.sourceUrl);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      unique.push(item);
    }
    const inspected = await mapWithConcurrency(unique, concurrency, fetchAndInspect);
    const accepted = [];
    for (let index = 0; index < unique.length; index += 1) {
      const item = unique[index];
      const result = await inspected[index];
      let reason = result.reason;
      let acceptedPublishedAt = result.publishedAt;
      if (
        reason
        && item?.__searchProCandidate
        && /^(?:published_date_missing|page_text_too_short:)/.test(reason)
        && /^\d{4}-\d{2}-\d{2}$/.test(item.publishedAt || "")
      ) {
        reason = null;
        acceptedPublishedAt = item.publishedAt;
        logger.warn(`${phase}：页面元数据不完整，采用 Search-Pro 返回的发布日期“${cleanText(item?.title || item?.newsTitle)}”。`);
      }
      if (!reason && mode === "industry" && (acceptedPublishedAt < industryFromDate || acceptedPublishedAt > reportDate)) {
        reason = `date_out_of_industry_window:${acceptedPublishedAt}`;
      }
      if (!reason && mode === "partner" && acceptedPublishedAt > reportDate) {
        reason = `future_date:${acceptedPublishedAt}`;
      }
      if (!reason && mode === "partner" && partnerFromDate && acceptedPublishedAt < partnerFromDate) {
        reason = `date_out_of_partner_window:${acceptedPublishedAt}`;
      }
      // 部分媒体会对自动验证返回 403，但浏览器中的原文仍然存在。只对已有
      // 验证基线的复用流程将 403 视为临时故障；新候选仍必须实际打开。
      const transientFailure = /^(?:fetch_error|read_error|http_403|http_408|http_429|http_5\d\d)/.test(reason || "");
      if (reason && allowTransientFailure && transientFailure) {
        stats.carriedForward += 1;
        accepted.push(item);
        logger.warn(`${phase}：临时网络故障，保留上期已有来源“${cleanText(item?.title || item?.newsTitle)}” → ${reason}`);
        continue;
      }
      if (reason) {
        stats.rejected += 1;
        stats.reasons[reason] = (stats.reasons[reason] || 0) + 1;
        logger.warn(`${phase}：淘汰“${cleanText(item?.title || item?.newsTitle)}” → ${reason}`);
        continue;
      }
      stats.accepted += 1;
      const publicItem = { ...item };
      delete publicItem.__searchProCandidate;
      accepted.push({
        ...publicItem,
        sourceUrl: result.finalUrl || item.sourceUrl,
        publishedAt: acceptedPublishedAt
      });
    }
    logger.log(`${phase}：${items.length} → ${accepted.length} 条通过真实页面验证。`);
    return accepted;
  }

  return { verifyItems, stats };
}

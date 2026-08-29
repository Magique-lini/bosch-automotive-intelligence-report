function positiveInteger(value, fallback, name, maximum) {
  const parsed = Number(value || fallback);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${name} 必须是 1 至 ${maximum} 之间的整数。`);
  }
  return parsed;
}

export function selectRotatingPartners(partners, reportDate, batchSize = 8) {
  if (!Array.isArray(partners) || !partners.length) return [];
  const size = Math.min(positiveInteger(batchSize, 8, "ZHIPU_PARTNER_SEARCH_BATCH_SIZE", 21), partners.length);
  const dayNumber = Math.floor(Date.parse(`${reportDate}T00:00:00Z`) / 86400000);
  const start = (dayNumber * size) % partners.length;
  return Array.from({ length: size }, (_, index) => partners[(start + index) % partners.length]);
}

export function buildSearchQuery(names, suffix = "汽车 最新 新闻") {
  const query = `${names.join(" OR ")} ${suffix}`.trim();
  return query.slice(0, 70);
}

export async function requestZhipuWebSearch({
  baseUrl,
  apiKey,
  query,
  searchEngine = "search_pro",
  count = 50,
  recency = "noLimit",
  contentSize = "high",
  timeoutMs = 60000,
  fetchImpl = globalThis.fetch
}) {
  const endpoint = `${baseUrl.replace(/\/+$/, "")}/web_search`;
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      search_query: query,
      search_engine: searchEngine,
      search_intent: false,
      count: positiveInteger(count, 50, "ZHIPU_DIRECT_SEARCH_COUNT", 50),
      search_recency_filter: recency,
      content_size: contentSize
    }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Search-Pro 请求失败 ${response.status}: ${body}`);
  }
  const payload = await response.json();
  return (Array.isArray(payload.search_result) ? payload.search_result : [])
    .filter((item) => /^https?:\/\//i.test(item?.link || ""))
    .map((item) => ({
      title: String(item.title || "").trim(),
      content: String(item.content || "").trim().slice(0, 800),
      link: item.link,
      media: String(item.media || "").trim(),
      publishDate: String(item.publish_date || "").slice(0, 10)
    }));
}

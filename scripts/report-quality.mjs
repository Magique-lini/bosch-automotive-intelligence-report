function normalizedUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const name of [...url.searchParams.keys()]) {
      if (/^(utm_|spm$|from$|source$)/i.test(name)) url.searchParams.delete(name);
    }
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch {
    return String(value || "").trim();
  }
}

function itemKeys(item) {
  const title = String(item?.title || "").trim().toLowerCase().replace(/\s+/g, " ");
  const publishedAt = String(item?.publishedAt || "").trim();
  return [
    item?.sourceUrl ? `url:${normalizedUrl(item.sourceUrl)}` : "",
    title ? `event:${publishedAt}:${title}` : ""
  ].filter(Boolean);
}

function titleTokens(value) {
  return new Set(String(value || "").toLowerCase().match(/[a-z0-9]+|[\u3400-\u9fff]{2,}/g) || []);
}

function isLikelySameEvent(left, right) {
  if (left?.category !== right?.category || left?.publishedAt !== right?.publishedAt) return false;
  const leftTokens = titleTokens(left?.title);
  const rightTokens = titleTokens(right?.title);
  if (leftTokens.size < 3 || rightTokens.size < 3) return false;
  const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return shared / Math.min(leftTokens.size, rightTokens.size) >= 0.7;
}

export function mergeIndustryNews(primary = [], additions = []) {
  const merged = [];
  const seen = new Set();
  for (const item of [...primary, ...additions]) {
    const keys = itemKeys(item);
    if (keys.some((key) => seen.has(key)) || merged.some((existing) => isLikelySameEvent(existing, item))) continue;
    merged.push(item);
    for (const key of keys) seen.add(key);
  }
  return merged;
}

export function findIndustryDeficits(industryNews, categories, minimumPerCategory) {
  return categories.flatMap((category) => {
    const count = industryNews.filter((item) => item.category === category).length;
    return count < minimumPerCategory
      ? [{ category, count, missing: minimumPerCategory - count }]
      : [];
  });
}

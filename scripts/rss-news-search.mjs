const DEFAULT_FEEDS = [
  { name: "CnEVPost", url: "https://cnevpost.com/feed/" },
  { name: "TechXplore Automotive", url: "https://techxplore.com/rss-feed/automotive-news/" },
  { name: "Electrive", url: "https://www.electrive.com/feed/" },
  { name: "Automotive World", url: "https://www.automotiveworld.com/feed/" }
];

function decodeXml(value = "") {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => {
      try { return String.fromCodePoint(Number(code)); } catch { return ""; }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      try { return String.fromCodePoint(parseInt(code, 16)); } catch { return ""; }
    })
    .trim();
}

function stripHtml(value = "") {
  return decodeXml(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function parseRssItems(xml, source) {
  return [...String(xml || "").matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map((match) => {
    const body = match[1];
    const field = (tag) => decodeXml(
      body.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1] || ""
    );
    const parsedDate = new Date(field("pubDate") || field("dc:date"));
    return {
      title: stripHtml(field("title")),
      content: stripHtml(field("description") || field("content:encoded")).slice(0, 800),
      link: field("link"),
      media: source,
      publishDate: Number.isNaN(parsedDate.getTime()) ? "" : parsedDate.toISOString().slice(0, 10)
    };
  }).filter((item) => item.title && /^https?:\/\//i.test(item.link));
}

export async function requestIndustryRssCandidates({
  fromDate,
  toDate,
  feeds = DEFAULT_FEEDS,
  perFeed = 12,
  timeoutMs = 30000,
  fetchImpl = globalThis.fetch
}) {
  const settled = await Promise.allSettled(feeds.map(async (feed) => {
    const response = await fetchImpl(feed.url, {
      headers: { "User-Agent": "Mozilla/5.0 partner-intelligence-report/1.0" },
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) throw new Error(`${feed.name} RSS 请求失败 ${response.status}`);
    const items = parseRssItems(await response.text(), feed.name)
      .filter((item) => item.publishDate >= fromDate && item.publishDate <= toDate)
      .slice(0, perFeed);
    return { feed, items };
  }));

  const candidates = [];
  const warnings = [];
  for (let index = 0; index < settled.length; index += 1) {
    const result = settled[index];
    if (result.status === "fulfilled") {
      candidates.push(...result.value.items);
    } else {
      warnings.push(`${feeds[index].name}: ${result.reason?.message || result.reason}`);
    }
  }
  const seen = new Set();
  return {
    candidates: candidates.filter((item) => {
      if (seen.has(item.link)) return false;
      seen.add(item.link);
      return true;
    }),
    warnings
  };
}

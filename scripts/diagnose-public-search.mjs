const query = "汽车 自动驾驶 芯片 量产 when:30d";
const endpoints = [
  ["Google News", `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`],
  ["Bing News", `https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss&mkt=zh-CN`],
  ["CnEVPost", "https://cnevpost.com/feed/"],
  ["TechXplore Automotive", "https://techxplore.com/rss-feed/automotive-news/"],
  ["Electrive", "https://www.electrive.com/feed/"],
  ["Automotive World", "https://www.automotiveworld.com/feed/"]
];

function decodeXml(value = "") {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

for (const [name, url] of endpoints) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    const text = await response.text();
    if (!response.ok) throw new Error(`${response.status}: ${text.slice(0, 200)}`);
    const items = [...text.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((match) => {
      const body = match[1];
      const field = (tag) => decodeXml(body.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1] || "");
      return { title: field("title"), link: field("link"), date: field("pubDate") };
    });
    console.log(`\n[${name}] ${items.length} 条`);
    for (const item of items.slice(0, 8)) {
      console.log(`- ${item.title} | ${item.date || "无日期"} | ${item.link}`);
    }
  } catch (error) {
    console.error(`\n[${name}] 失败：${error.message}`);
  }
}

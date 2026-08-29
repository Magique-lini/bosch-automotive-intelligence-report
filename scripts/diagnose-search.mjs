import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requestZhipuWebSearch } from "./zhipu-web-search.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const rawLine of fs.readFileSync(path.join(rootDir, ".env"), "utf8").split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line || line.startsWith("#")) continue;
  const separator = line.indexOf("=");
  if (separator < 1) continue;
  const key = line.slice(0, separator).trim();
  const value = line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
  if (!(key in process.env)) process.env[key] = value;
}

const defaultQueries = [
  "2026年8月 汽车行业 新闻",
  "2026年8月 自动驾驶 量产",
  "2026年8月 汽车芯片",
  "2026年8月 汽车政策",
  "2026年8月 汽车企业 人事 任命"
];
const queries = process.argv.slice(2).length ? process.argv.slice(2) : defaultQueries;

for (const query of queries) {
  try {
    const items = await requestZhipuWebSearch({
      baseUrl: process.env.ZHIPU_BASE_URL,
      apiKey: process.env.ZHIPU_API_KEY,
      query,
      searchEngine: process.env.ZHIPU_SEARCH_ENGINE || "search_pro",
      count: 10,
      recency: "noLimit",
      contentSize: "medium",
      timeoutMs: 60000
    });
    console.log(`\n[${query}] ${items.length} 条`);
    for (const item of items.slice(0, 5)) {
      console.log(`- ${item.title} | ${item.publishDate || "无日期"} | ${item.link}`);
    }
  } catch (error) {
    console.error(`\n[${query}] 失败：${error.message}`);
  }
}

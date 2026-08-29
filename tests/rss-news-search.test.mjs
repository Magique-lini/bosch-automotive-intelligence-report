import assert from "node:assert/strict";
import test from "node:test";
import { parseRssItems, requestIndustryRssCandidates } from "../scripts/rss-news-search.mjs";

test("解析 RSS 为可验证的直接行业候选", () => {
  const xml = `<rss><channel><item><title><![CDATA[Example&#039;s &amp; title]]></title><link>https://example.com/news/1</link><pubDate>Thu, 27 Aug 2026 12:00:00 +0000</pubDate><description><![CDATA[<p>Automotive update</p>]]></description></item></channel></rss>`;
  assert.deepEqual(parseRssItems(xml, "Example Feed"), [{
    title: "Example's & title",
    content: "Automotive update",
    link: "https://example.com/news/1",
    media: "Example Feed",
    publishDate: "2026-08-27"
  }]);
});

test("RSS 兜底仅保留行业时间窗口内的候选", async () => {
  const xml = `<rss><channel>
    <item><title>Recent</title><link>https://example.com/recent</link><pubDate>Thu, 27 Aug 2026 12:00:00 +0000</pubDate></item>
    <item><title>Old</title><link>https://example.com/old</link><pubDate>Thu, 27 Jun 2026 12:00:00 +0000</pubDate></item>
  </channel></rss>`;
  const result = await requestIndustryRssCandidates({
    fromDate: "2026-07-30",
    toDate: "2026-08-28",
    feeds: [{ name: "Test", url: "https://example.com/feed" }],
    fetchImpl: async () => ({ ok: true, text: async () => xml })
  });
  assert.deepEqual(result.candidates.map((item) => item.title), ["Recent"]);
});

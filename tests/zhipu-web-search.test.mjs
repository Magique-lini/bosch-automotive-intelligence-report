import assert from "node:assert/strict";
import test from "node:test";
import { buildSearchQuery, requestZhipuWebSearch, selectRotatingPartners } from "../scripts/zhipu-web-search.mjs";

test("Partner 轮换搜索每日只选定量公司", () => {
  const partners = Array.from({ length: 21 }, (_, index) => ({ name: `P${index + 1}` }));
  const selected = selectRotatingPartners(partners, "2026-08-27", 8);
  assert.equal(selected.length, 8);
  assert.equal(new Set(selected.map((item) => item.name)).size, 8);
  assert.ok(buildSearchQuery(selected.map((item) => item.name)).length <= 70);
});

test("Search-Pro 直接 API 只返回结构化 HTTP 候选链接", async () => {
  let requestBody;
  const items = await requestZhipuWebSearch({
    baseUrl: "https://open.bigmodel.cn/api/paas/v4/",
    apiKey: "test-key",
    query: "汽车行业新闻",
    fetchImpl: async (_url, init) => {
      requestBody = JSON.parse(init.body);
      return new Response(JSON.stringify({
        search_result: [
          { title: "真实新闻", content: "摘要", link: "https://example.com/news/1", media: "Example", publish_date: "2026-08-26" },
          { title: "无效链接", link: "javascript:void(0)" }
        ]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  assert.equal(requestBody.search_engine, "search_pro");
  assert.equal(requestBody.count, 50);
  assert.equal(items.length, 1);
  assert.equal(items[0].link, "https://example.com/news/1");
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  isIndustryCategoryRelevant,
  isPartnerCandidateRelevant,
  normalizeIndustryAnalysis
} from "../scripts/report-relevance.mjs";

test("人事栏只接受真实的任免动作", () => {
  assert.equal(isIndustryCategoryRelevant({
    category: "人事变动 | Change of Personnel",
    title: "Hyundai CEO Investor Day margin target"
  }), false);
  assert.equal(isIndustryCategoryRelevant({
    category: "人事变动 | Change of Personnel",
    title: "Supplier appoints new automotive division CEO"
  }), true);
});

test("Partner 候选必须与汽车或重大公司动作相关", () => {
  assert.equal(isPartnerCandidateRelevant({ title: "New generic graphics trick", content: "consumer gaming" }), false);
  assert.equal(isPartnerCandidateRelevant({ title: "Qualcomm launches automotive cockpit platform" }), true);
  assert.equal(isPartnerCandidateRelevant({ title: "极豆科技完成新一轮融资" }), true);
});

test("英文标题不再被当作 Tier 1 影响分析", () => {
  const item = normalizeIndustryAnalysis({
    category: "车企动态 | OEM Trend",
    highlight: "Voyah H1 2026 net loss"
  });
  assert.match(item.highlight, /项目定点/);
});

test("电池技术新闻不应被强行分到产经栏", () => {
  assert.equal(isIndustryCategoryRelevant({
    category: "产经聚焦 | Industrial Economy",
    title: "BYD could bring battery tech to a new European EV"
  }), false);
  assert.equal(isIndustryCategoryRelevant({
    category: "产经聚焦 | Industrial Economy",
    title: "Global light vehicle sales forecast"
  }), true);
});

const categoryTerms = {
  "人事变动 | Change of Personnel": [
    /任命|离任|离职|辞任|辞职|卸任|接任|升任|出任|履新|加盟|人事调整|管理层变动/i,
    /\b(?:appoint(?:s|ed|ment)?|resign(?:s|ed|ation)?|steps? down|named (?:as )?(?:new )?|executive change|leadership change|new (?:ceo|cto|cfo|president|chair(?:man|woman)?))\b/i
  ],
  "政策动态 | Policy Situation": [
    /政策|监管|法规|标准|法案|规范|征求意见|合规|认证|许可|安全要求|专项行动/i,
    /\b(?:policy|regulation|regulatory|standard|law|legislation|compliance|certification|permit|safety requirement|government campaign)\b/i
  ],
  "零部件企业 | Parts Enterprises": [
    /零部件|供应商|电机|电池|芯片|半导体|雷达|激光雷达|域控|座舱|传感器|热管理|线控/i,
    /\b(?:supplier|component|motor|battery|chip|semiconductor|lidar|radar|cockpit|sensor|thermal management)\b/i
  ],
  "产经聚焦 | Industrial Economy": [
    /市场|需求|销量|销售|产销|价格|营收|利润|亏损|产量|产能|预测|进出口|经济|供应链/i,
    /\b(?:market|demand|sales|revenue|profit|loss|output|capacity|forecast|export|import|econom(?:y|ic)|supply chain)\b/i
  ]
};

const automotiveTerms = /汽车|车载|车规|座舱|智驾|自动驾驶|辅助驾驶|域控|车型|量产|定点|robotaxi|automotive|vehicle|cockpit|adas|autonomous driv|driver assistance/i;
const strategicTerms = /融资|首发上市|\bipo\b|收购|并购|战略投资|战略合作|签约|量产|定点|订单|产能|财报|业绩|交付|funding|acqui(?:re|sition)|partnership|production|order|capacity|earnings/i;

export function isIndustryCategoryRelevant(item) {
  const matchers = categoryTerms[item?.category];
  if (!matchers) return true;
  const searchable = `${item?.title || ""} ${item?.summary || ""}`;
  return matchers.some((matcher) => matcher.test(searchable));
}

export function isPartnerCandidateRelevant(candidate) {
  const searchable = `${candidate?.title || ""} ${candidate?.content || ""}`;
  return automotiveTerms.test(searchable) || strategicTerms.test(searchable);
}

function hasUsefulChineseAnalysis(value) {
  const text = String(value || "").trim();
  const chineseCount = (text.match(/[\u3400-\u9fff]/g) || []).length;
  const impactLanguage = /可能|需|建议|有助|影响|带动|机会|风险|竞争|供应链|定点|产能|成本|合规|交付|需求|价格|布局/;
  return chineseCount >= 18 && text.length >= 32 && impactLanguage.test(text);
}

const fallbackHighlights = {
  "车企动态 | OEM Trend": "可能影响车型导入、项目定点与配套节奏，需继续跟踪量产规模和区域扩张进展。",
  "零部件企业 | Parts Enterprises": "反映零部件技术路线与供应格局变化，需评估成本、产能和项目定点机会。",
  "产经聚焦 | Industrial Economy": "可能影响汽车需求、价格与供应链节奏，建议持续跟踪区域市场和客户订单变化。",
  "政策动态 | Policy Situation": "将提高整车及供应商的合规与验证要求，需评估认证、软件安全和项目交付影响。",
  "人事变动 | Change of Personnel": "关键管理层变动可能影响战略、采购和研发决策，需关注后续组织与项目调整。"
};

export function normalizeIndustryAnalysis(item) {
  if (hasUsefulChineseAnalysis(item?.highlight)) return item;
  return { ...item, highlight: fallbackHighlights[item?.category] || "需结合客户项目、供应链与合规要求，进一步评估对汽车 Tier 1 业务的影响。" };
}

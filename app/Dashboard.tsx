"use client";

import { useMemo, useState } from "react";
import { archiveDates, reportsByDate } from "./data";

const industryCategories = [
  "车企动态 | OEM Trend",
  "零部件企业 | Parts Enterprises",
  "产经聚焦 | Industrial Economy",
  "政策动态 | Policy Situation",
  "人事变动 | Change of Personnel",
];

function formatDate(date?: string) {
  if (!date) return "待首次采集";
  return date.replaceAll("-", ".");
}

function StatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    NEW: "NEW 新动态",
    UPDATED: "UPDATED 已修订",
    "NO CHANGE": "NO CHANGE 无变化",
    BASELINE: "LATEST 当前最新",
  };
  return <span className={`status status-${status.toLowerCase().replace(" ", "-")}`}>{labels[status] ?? status}</span>;
}

export default function Dashboard() {
  const [query, setQuery] = useState("");
  const [partnerCategory, setPartnerCategory] = useState("全部");
  const [updatesOnly, setUpdatesOnly] = useState(false);
  const [archiveDate, setArchiveDate] = useState(archiveDates[0]);
  const selectedReport = reportsByDate[archiveDate] ?? reportsByDate[archiveDates[0]];
  const industryNews = selectedReport.industryNews;
  const partners = selectedReport.partners;
  const partnerCategories = [...new Set(partners.map((partner) => partner.category))];

  const filteredPartners = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return partners.filter((partner) => {
      const categoryMatch = partnerCategory === "全部" || partner.category === partnerCategory;
      const updateMatch = !updatesOnly || ["NEW", "UPDATED"].includes(partner.status);
      const queryMatch =
        !normalized ||
        [
          partner.name,
          partner.focus,
          partner.category,
          ...partner.news.flatMap((item) => [item.newsTitle, item.summary, item.highlight, item.source]),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(normalized);
      return categoryMatch && updateMatch && queryMatch;
    });
  }, [query, partnerCategory, updatesOnly, partners]);

  const newCount = industryNews.filter((item) => item.isNew).length;
  const partnerUpdateCount = partners.filter((item) => ["NEW", "UPDATED"].includes(item.status)).length;
  const sourceCount = new Set(industryNews.map((item) => item.source)).size;

  return (
    <main>
      <header className="masthead">
        <h1>汽车行业情报日报</h1>
        <div className="report-meta">
          <span>报告日期</span>
          <strong>{formatDate(archiveDate)}</strong>
          <small>最后更新 08:00 CST</small>
        </div>
      </header>

      <nav className="section-nav" aria-label="日报栏目">
        <a href="#industry">行业动态</a>
        <a href="#partners">Partner Watchlist</a>
        <a href="#archive">20天归档</a>
      </nav>

      <section className="content-section industry-section" id="industry">
        <div className="section-heading">
          <div><span>PART 01</span><h2>每日行业动态</h2></div>
          <p>
            {formatDate(archiveDate)} · 共 {industryNews.length} 条 · {sourceCount} 个来源 ·
            今日新增 {newCount} 条
          </p>
        </div>

        <div className="industry-grid">
          {industryCategories.map((category, categoryIndex) => {
            const items = industryNews.filter((item) => item.category === category);
            return (
              <section className="news-category" key={category} id={`category-${categoryIndex}`}>
                <header>
                  <span>{String(categoryIndex + 1).padStart(2, "0")}</span>
                  <h3>{category}</h3>
                  <em>{items.length} 条</em>
                </header>
                {items.length ? items.map((item) => (
                  <article className="news-card" key={item.id}>
                    <div className="news-meta">
                      {item.isNew && <span className="new-flag">NEW</span>}
                      <span>{item.source}</span>
                      <time>{formatDate(item.publishedAt)}</time>
                      <span>可信度 {item.confidence}</span>
                    </div>
                    <h4>{item.title}</h4>
                    <p>{item.summary}</p>
                    <p className="highlight"><strong>重点：</strong>{item.highlight}</p>
                    <div className="tag-row">
                      <div>{item.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>
                      <a href={item.sourceUrl} target="_blank" rel="noreferrer">原文 ↗</a>
                    </div>
                  </article>
                )) : (
                  <div className="empty-state">
                    <span>—</span>
                    <p>近 30 日未检出高置信度重要动态</p>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </section>

      <section className="content-section partner-section" id="partners">
        <div className="section-heading">
          <div><span>PART 02</span><h2>关键 Partner 最新动态</h2></div>
          <p>
            {partners.length} 家监测 · {partners.reduce((total, partner) => total + partner.news.length, 0)} 条动态 ·
            本期变化 {partnerUpdateCount} 家
          </p>
        </div>

        <div className="control-bar">
          <label className="search-field">
            <span>搜索</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Partner、产品、新闻或标签" />
          </label>
          <label>
            <span>分类</span>
            <select value={partnerCategory} onChange={(event) => setPartnerCategory(event.target.value)}>
              <option>全部</option>
              {partnerCategories.map((category) => <option key={category}>{category}</option>)}
            </select>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={updatesOnly} onChange={(event) => setUpdatesOnly(event.target.checked)} />
            <span>仅看更新</span>
          </label>
          <div className="result-count"><strong>{filteredPartners.length}</strong> / {partners.length}</div>
        </div>

        <div className="partner-table">
          <div className="partner-row partner-header" aria-hidden="true">
            <span>Partner / 分类</span><span>关注业务 / 状态</span><span>最近动态</span>
          </div>
          {filteredPartners.map((partner) => (
            <article className="partner-row" key={partner.name}>
              <div className="partner-name">
                <h3>{partner.name}</h3>
                <span>{partner.category}</span>
              </div>
              <div className="partner-focus">
                <span className={`priority priority-${partner.priority}`}>{partner.priority}</span>
                <p>{partner.focus}</p>
                <StatusBadge status={partner.status} />
              </div>
              <div className="partner-news-list">
                {partner.news.length ? partner.news.map((item, index) => (
                  <section className="partner-news" key={`${partner.name}-${item.sourceUrl}-${index}`}>
                    <div className="partner-news-meta">
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <time>{formatDate(item.publishedAt)}</time>
                      <span>可信度 {item.confidence}</span>
                    </div>
                    <h4>{item.newsTitle}</h4>
                    <p>{item.summary}</p>
                    <p className="partner-highlight"><strong>重点：</strong>{item.highlight}</p>
                    <a href={item.sourceUrl} target="_blank" rel="noreferrer">{item.source} ↗</a>
                  </section>
                )) : (
                  <div className="empty-state">
                    <span>—</span>
                    <p>近 12 个月未检出与汽车业务直接相关的可信动态</p>
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="content-section archive-section" id="archive">
        <div className="section-heading">
          <div><span>PART 03</span><h2>最近 20 天日报</h2></div>
        </div>
        <div className="archive-grid">
          {archiveDates.map((date, index) => (
            <button key={date} className={archiveDate === date ? "active" : ""} onClick={() => setArchiveDate(date)}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{formatDate(date)}</strong>
              <small>{index === 0 ? "当前报告" : "历史快照"}</small>
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type {
  CandidatePoolItem,
  CuratedEncounter,
  DurabilityTier,
} from "../domain/contracts.js";
import type { GitHubPagesConfiguration } from "../config/configuration.js";

const execFileAsync = promisify(execFile);

export interface RemoteExposureRecord {
  fingerprint: string;
  exposed_at: string;
}

export class GitHubRssPublisher {
  readonly #config: GitHubPagesConfiguration;

  constructor(config: GitHubPagesConfiguration) {
    this.#config = config;
  }

  async syncRemoteExposures(): Promise<RemoteExposureRecord[]> {
    const exposuresPath = resolve(
      this.#config.repo_path,
      this.#config.publish_dir,
      "exposures.json",
    );
    try {
      const text = await readFile(exposuresPath, "utf8");
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (item): item is RemoteExposureRecord =>
            typeof item?.fingerprint === "string" &&
            typeof item?.exposed_at === "string",
        );
      }
      if (Array.isArray(parsed?.exposures)) {
        return parsed.exposures.filter(
          (item: unknown): item is RemoteExposureRecord =>
            typeof (item as any)?.fingerprint === "string" &&
            typeof (item as any)?.exposed_at === "string",
        );
      }
      return [];
    } catch {
      return [];
    }
  }

  async publish(options: {
    curatedEncounters: CuratedEncounter[];
    poolMaterials: CandidatePoolItem[];
  }): Promise<{
    curatedXmlPath: string;
    poolXmlPath: string;
    evergreenXmlPath: string;
    emergingXmlPath: string;
    horizonXmlPath: string;
    indexPath: string;
  }> {
    const targetDir = resolve(this.#config.repo_path, this.#config.publish_dir);
    await mkdir(targetDir, { recursive: true });

    const curatedXml = this.generateCuratedRssXml(options.curatedEncounters);
    const poolXml = this.generatePoolRssXml(options.poolMaterials);

    const evergreenMaterials = options.poolMaterials
      .filter((m) => m.durabilityTier === "evergreen")
      .slice(0, 50);
    const emergingMaterials = options.poolMaterials
      .filter((m) => m.durabilityTier === "emerging")
      .slice(0, 50);
    const horizonMaterials = options.poolMaterials
      .filter((m) => m.durabilityTier === "horizon")
      .slice(0, 50);

    const evergreenXml = this.generateTierRssXml(
      evergreenMaterials,
      "evergreen",
      "Musement Evergreen Candidates",
      "Decadal, timeless knowledge and enduring principles",
    );
    const emergingXml = this.generateTierRssXml(
      emergingMaterials,
      "emerging",
      "Musement Emerging Candidates",
      "Multi-year and monthly paradigm shifts, architectural deep-dives, and podcasts",
    );
    const horizonXml = this.generateTierRssXml(
      horizonMaterials,
      "horizon",
      "Musement Horizon Candidates",
      "Fast-moving ambient updates, current events, and tangents",
    );

    const indexHtml = this.generateIndexHtml(
      options.curatedEncounters,
      options.poolMaterials,
    );

    const curatedXmlPath = resolve(targetDir, "curated.xml");
    const poolXmlPath = resolve(targetDir, "pool.xml");
    const evergreenXmlPath = resolve(targetDir, "pool-evergreen.xml");
    const emergingXmlPath = resolve(targetDir, "pool-emerging.xml");
    const horizonXmlPath = resolve(targetDir, "pool-horizon.xml");
    const indexPath = resolve(targetDir, "index.html");
    const exposuresPath = resolve(targetDir, "exposures.json");

    await writeFile(curatedXmlPath, curatedXml, "utf8");
    await writeFile(poolXmlPath, poolXml, "utf8");
    await writeFile(evergreenXmlPath, evergreenXml, "utf8");
    await writeFile(emergingXmlPath, emergingXml, "utf8");
    await writeFile(horizonXmlPath, horizonXml, "utf8");
    await writeFile(indexPath, indexHtml, "utf8");

    try {
      await readFile(exposuresPath, "utf8");
    } catch {
      await writeFile(exposuresPath, "[]\n", "utf8");
    }

    if (this.#config.auto_push) {
      await this.#gitCommitAndPush(targetDir);
    }

    return {
      curatedXmlPath,
      poolXmlPath,
      evergreenXmlPath,
      emergingXmlPath,
      horizonXmlPath,
      indexPath,
    };
  }

  generateCuratedRssXml(encounters: CuratedEncounter[]): string {
    const baseUrl = this.#config.site_base_url.replace(/\/+$/, "");
    const feedUrl = `${baseUrl}/curated.xml`;

    const itemsXml = encounters
      .flatMap((encounter) =>
        encounter.discoveries.map((discovery) => {
          const material = discovery.recommendedMaterial;
          const pubDate = new Date(encounter.pulledAt).toUTCString();
          const actionCallbackUrl = makeIssueCallbackUrl(
            material.fingerprint,
            discovery.title,
          );

          const descHtml = `
<p><strong>${escapeXml(discovery.title)}</strong></p>
<p>${escapeXml(discovery.summary)}</p>
<blockquote><em>Why selected:</em> ${escapeXml(discovery.slotReason)}</blockquote>
<p><strong>Evidence Status:</strong> ${escapeXml(discovery.evidenceStatus)}</p>
<p><strong>Source:</strong> ${escapeXml(material.source)} (${escapeXml(material.format)}) | <strong>Author:</strong> ${escapeXml(material.author)}</p>
<p><strong>Estimated Reading Time:</strong> ${material.meaningfulEntryMinutes} min</p>
<hr/>
<p><a href="${escapeXml(material.url)}">👉 Open Source Material</a> &nbsp;|&nbsp; <a href="${escapeXml(actionCallbackUrl)}">✅ Mark as Read in Musement</a></p>
`.trim();

          return `    <item>
      <title>${escapeXml(discovery.title)}</title>
      <link>${escapeXml(material.url)}</link>
      <guid isPermaLink="false">musement:curated:${escapeXml(discovery.id)}</guid>
      <pubDate>${pubDate}</pubDate>
      <description><![CDATA[${descHtml}]]></description>
    </item>`;
        }),
      )
      .join("\n");

    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Musement Curated Encounters</title>
    <link>${escapeXml(baseUrl)}</link>
    <description>On-demand AI-curated reading encounters from Musement</description>
    <language>en-us</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml"/>
${itemsXml}
  </channel>
</rss>
`;
  }

  generateTierRssXml(
    poolMaterials: CandidatePoolItem[],
    tier: DurabilityTier,
    feedTitle: string,
    feedDescription: string,
  ): string {
    const baseUrl = this.#config.site_base_url.replace(/\/+$/, "");
    const feedUrl = `${baseUrl}/pool-${tier}.xml`;

    const itemsXml = poolMaterials
      .map((item) => {
        const pubDate = new Date(
          item.publishedAt ?? item.fetchedAt,
        ).toUTCString();
        const actionCallbackUrl = makeIssueCallbackUrl(
          item.fingerprint,
          item.title,
        );

        const descHtml = `
<p><strong>Source:</strong> ${escapeXml(item.sourceName)} | <strong>Author:</strong> ${escapeXml(item.author ?? "Unknown")}</p>
<p><strong>Durability Tier:</strong> [${escapeXml((item.durabilityTier ?? "emerging").toUpperCase())}]</p>
<p>${escapeXml(item.summary)}</p>
<p><strong>Estimated Time:</strong> ${item.estimatedMinutes} min (${escapeXml(item.format)})</p>
<hr/>
<p><a href="${escapeXml(item.url)}">👉 Read Material</a> &nbsp;|&nbsp; <a href="${escapeXml(actionCallbackUrl)}">✅ Mark as Read in Musement</a></p>
`.trim();

        return `    <item>
      <title>[${escapeXml(item.sourceName)}] ${escapeXml(item.title)}</title>
      <link>${escapeXml(item.url)}</link>
      <guid isPermaLink="false">musement:pool:${escapeXml(item.fingerprint)}</guid>
      <pubDate>${pubDate}</pubDate>
      <description><![CDATA[${descHtml}]]></description>
    </item>`;
      })
      .join("\n");

    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(feedTitle)}</title>
    <link>${escapeXml(baseUrl)}</link>
    <description>${escapeXml(feedDescription)}</description>
    <language>en-us</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml"/>
${itemsXml}
  </channel>
</rss>
`;
  }

  generatePoolRssXml(poolMaterials: CandidatePoolItem[]): string {
    const baseUrl = this.#config.site_base_url.replace(/\/+$/, "");
    const feedUrl = `${baseUrl}/pool.xml`;

    const itemsXml = poolMaterials
      .slice(0, 100)
      .map((item) => {
        const pubDate = new Date(
          item.publishedAt ?? item.fetchedAt,
        ).toUTCString();
        const actionCallbackUrl = makeIssueCallbackUrl(
          item.fingerprint,
          item.title,
        );

        const descHtml = `
<p><strong>Source:</strong> ${escapeXml(item.sourceName)} | <strong>Author:</strong> ${escapeXml(item.author ?? "Unknown")}</p>
<p><strong>Durability Tier:</strong> [${escapeXml((item.durabilityTier ?? "emerging").toUpperCase())}]</p>
<p>${escapeXml(item.summary)}</p>
<p><strong>Estimated Time:</strong> ${item.estimatedMinutes} min (${escapeXml(item.format)})</p>
<hr/>
<p><a href="${escapeXml(item.url)}">👉 Read Article</a> &nbsp;|&nbsp; <a href="${escapeXml(actionCallbackUrl)}">✅ Mark as Read in Musement</a></p>
`.trim();

        return `    <item>
      <title>[${escapeXml(item.sourceName)}] ${escapeXml(item.title)}</title>
      <link>${escapeXml(item.url)}</link>
      <guid isPermaLink="false">musement:pool:${escapeXml(item.fingerprint)}</guid>
      <pubDate>${pubDate}</pubDate>
      <description><![CDATA[${descHtml}]]></description>
    </item>`;
      })
      .join("\n");

    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Musement Candidate Pool</title>
    <link>${escapeXml(baseUrl)}</link>
    <description>Unexposed candidate materials collected from configured sources</description>
    <language>en-us</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml"/>
${itemsXml}
  </channel>
</rss>
`;
  }

  generateIndexHtml(
    encounters: CuratedEncounter[],
    poolMaterials: CandidatePoolItem[],
  ): string {
    const baseUrl = this.#config.site_base_url.replace(/\/+$/, "");
    const curatedFeedUrl = `${baseUrl}/curated.xml`;
    const evergreenFeedUrl = `${baseUrl}/pool-evergreen.xml`;
    const emergingFeedUrl = `${baseUrl}/pool-emerging.xml`;
    const horizonFeedUrl = `${baseUrl}/pool-horizon.xml`;

    const evergreenCount = poolMaterials.filter(
      (m) => m.durabilityTier === "evergreen",
    ).length;
    const emergingCount = poolMaterials.filter(
      (m) => m.durabilityTier === "emerging",
    ).length;
    const horizonCount = poolMaterials.filter(
      (m) => m.durabilityTier === "horizon",
    ).length;

    const sources = [
      ...new Map(
        poolMaterials.map((m) => [m.sourceId, m.sourceName]),
      ).entries(),
    ].map(([id, name]) => ({ id, name }));

    const curatedCardsHtml = encounters
      .flatMap((encounter) =>
        encounter.discoveries.map((discovery, idx) => {
          const material = discovery.recommendedMaterial;
          const callbackUrl = makeIssueCallbackUrl(
            material.fingerprint,
            discovery.title,
          );
          return `
          <article class="card">
            <div class="card-meta">
              <span class="badge badge-accent">Encounter #${idx + 1}</span>
              ${encounter.direction ? `<span class="badge badge-direction">🎯 ${escapeHtml(encounter.direction)}</span>` : ""}
              <span class="badge badge-muted">${escapeHtml(discovery.evidenceStatus)}</span>
            </div>
            <h2 class="card-title">
              <a href="${escapeHtml(material.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(discovery.title)}</a>
            </h2>
            <p class="card-summary">${escapeHtml(discovery.summary)}</p>
            <blockquote class="card-reason">
              <strong>Why selected:</strong> ${escapeHtml(discovery.slotReason)}
            </blockquote>
            <div class="card-footer">
              <span class="source-tag">${escapeHtml(material.source)} (${escapeHtml(material.format)}) · ${escapeHtml(material.author)} · ${material.meaningfulEntryMinutes} min</span>
              <div class="card-actions">
                <a href="${escapeHtml(material.url)}" class="btn btn-outline" target="_blank" rel="noopener noreferrer">📖 Read</a>
                <a href="${escapeHtml(callbackUrl)}" class="btn btn-primary" target="_blank" rel="noopener noreferrer">✅ Mark as Read</a>
              </div>
            </div>
          </article>`;
        }),
      )
      .join("\n");

    const poolDataJson = JSON.stringify(
      poolMaterials.map((item) => ({
        fingerprint: item.fingerprint,
        title: item.title,
        url: item.url,
        sourceId: item.sourceId,
        sourceName: item.sourceName,
        author: item.author ?? "Unknown",
        publishedAt: item.publishedAt ?? item.fetchedAt,
        fetchedAt: item.fetchedAt,
        summary: item.summary,
        estimatedMinutes: item.estimatedMinutes,
        format: item.format,
        durabilityTier: item.durabilityTier ?? "emerging",
        callbackUrl: makeIssueCallbackUrl(item.fingerprint, item.title),
      })),
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Musement Feeds · Knowledge Exploration</title>
  <style>
    :root {
      --bg: #0b0f19;
      --card-bg: #151d30;
      --card-border: #243049;
      --text: #f1f5f9;
      --text-muted: #94a3b8;
      --accent: #38bdf8;
      --accent-hover: #0ea5e9;
      --quote-bg: #0f172a;
      --btn-bg: #2563eb;
      --btn-hover: #1d4ed8;
      --tier-evergreen: #10b981;
      --tier-emerging: #f59e0b;
      --tier-horizon: #ec4899;
      --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    @media (prefers-color-scheme: light) {
      :root {
        --bg: #f8fafc;
        --card-bg: #ffffff;
        --card-border: #e2e8f0;
        --text: #0f172a;
        --text-muted: #64748b;
        --accent: #0284c7;
        --accent-hover: #0369a1;
        --quote-bg: #f1f5f9;
        --btn-bg: #0284c7;
        --btn-hover: #0369a1;
        --tier-evergreen: #059669;
        --tier-emerging: #d97706;
        --tier-horizon: #db2777;
      }
    }
    * { box-sizing: border-box; }
    body {
      font-family: var(--font);
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      margin: 0;
      padding: 2rem 1rem;
    }
    .container { max-width: 860px; margin: 0 auto; }
    header {
      margin-bottom: 2rem;
      padding-bottom: 1.5rem;
      border-bottom: 1px solid var(--card-border);
    }
    .header-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 1rem;
    }
    h1 { margin: 0; font-size: 1.85rem; font-weight: 700; color: var(--text); letter-spacing: -0.02em; }
    .subtitle { color: var(--text-muted); margin: 0.4rem 0 0 0; font-size: 0.95rem; }
    .rss-links {
      display: flex;
      gap: 0.6rem;
      margin-top: 1.25rem;
      flex-wrap: wrap;
    }
    .rss-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.35rem 0.75rem;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      color: var(--text);
      font-size: 0.85rem;
      text-decoration: none;
      font-weight: 500;
      transition: all 0.15s;
    }
    .rss-btn:hover { border-color: var(--accent); color: var(--accent); }
    .tabs {
      display: flex;
      gap: 1rem;
      margin-bottom: 1.5rem;
      border-bottom: 1px solid var(--card-border);
    }
    .tab-btn {
      padding: 0.75rem 1rem;
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      color: var(--text-muted);
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
    }
    .tab-btn.active {
      color: var(--accent);
      border-bottom-color: var(--accent);
    }
    .toolbar {
      display: flex;
      flex-direction: column;
      gap: 0.85rem;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 1.1rem;
      margin-bottom: 1.5rem;
    }
    .filter-group {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .filter-label {
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--text-muted);
      min-width: 65px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .pill-btn {
      padding: 0.3rem 0.75rem;
      border-radius: 20px;
      border: 1px solid var(--card-border);
      background: var(--bg);
      color: var(--text-muted);
      font-size: 0.82rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s;
      font-family: inherit;
    }
    .pill-btn:hover { color: var(--text); border-color: var(--accent); }
    .pill-btn.active {
      background: var(--accent);
      color: #000;
      border-color: var(--accent);
      font-weight: 600;
    }
    .pill-btn.pill-evergreen.active { background: var(--tier-evergreen); color: #fff; border-color: var(--tier-evergreen); }
    .pill-btn.pill-emerging.active { background: var(--tier-emerging); color: #000; border-color: var(--tier-emerging); }
    .pill-btn.pill-horizon.active { background: var(--tier-horizon); color: #fff; border-color: var(--tier-horizon); }
    .sort-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-top: 0.75rem;
      border-top: 1px solid var(--card-border);
      flex-wrap: wrap;
      gap: 0.75rem;
    }
    .select-control {
      background: var(--bg);
      color: var(--text);
      border: 1px solid var(--card-border);
      border-radius: 6px;
      padding: 0.35rem 0.75rem;
      font-size: 0.85rem;
      font-family: inherit;
    }
    .tab-content { display: none; }
    .tab-content.active { display: block; }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 1.4rem;
      margin-bottom: 1.25rem;
      box-shadow: 0 2px 4px rgba(0,0,0,0.04);
      transition: transform 0.15s;
    }
    .card:hover { transform: translateY(-1px); border-color: var(--card-border); }
    .card-meta {
      display: flex;
      gap: 0.5rem;
      align-items: center;
      flex-wrap: wrap;
      margin-bottom: 0.75rem;
    }
    .badge {
      font-size: 0.75rem;
      font-weight: 600;
      padding: 0.2rem 0.55rem;
      border-radius: 6px;
      background: var(--card-border);
      color: var(--text);
    }
    .badge-accent { background: var(--accent); color: #000; }
    .badge-direction { background: #6366f1; color: #fff; }
    .badge-source { background: #3b82f6; color: #fff; }
    .badge-evergreen { background: var(--tier-evergreen); color: #ffffff; }
    .badge-emerging { background: var(--tier-emerging); color: #000000; }
    .badge-horizon { background: var(--tier-horizon); color: #ffffff; }
    .badge-muted { background: transparent; border: 1px solid var(--card-border); color: var(--text-muted); }
    .timestamp { font-size: 0.8rem; color: var(--text-muted); margin-left: auto; }
    .card-title {
      margin: 0 0 0.5rem 0;
      font-size: 1.25rem;
      line-height: 1.4;
    }
    .card-title a {
      color: var(--text);
      text-decoration: none;
    }
    .card-title a:hover {
      color: var(--accent);
      text-decoration: underline;
    }
    .card-summary {
      color: var(--text);
      margin: 0 0 1rem 0;
      font-size: 0.95rem;
    }
    .card-reason {
      margin: 0.75rem 0;
      padding: 0.6rem 0.9rem;
      background: var(--quote-bg);
      border-left: 3px solid var(--accent);
      border-radius: 4px;
      font-size: 0.9rem;
      color: var(--text-muted);
    }
    .card-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.75rem;
      margin-top: 1rem;
      padding-top: 0.75rem;
      border-top: 1px solid var(--card-border);
    }
    .source-tag { font-size: 0.85rem; color: var(--text-muted); }
    .card-actions { display: flex; gap: 0.5rem; }
    .btn {
      display: inline-flex;
      align-items: center;
      padding: 0.4rem 0.8rem;
      border-radius: 6px;
      font-size: 0.85rem;
      font-weight: 500;
      text-decoration: none;
      transition: all 0.15s;
      cursor: pointer;
      border: 1px solid transparent;
    }
    .btn-outline {
      border: 1px solid var(--card-border);
      background: transparent;
      color: var(--text);
    }
    .btn-outline:hover {
      border-color: var(--accent);
      color: var(--accent);
    }
    .btn-primary {
      background: var(--btn-bg);
      color: #ffffff;
    }
    .btn-primary:hover {
      background: var(--btn-hover);
    }
    .empty-state {
      text-align: center;
      padding: 3.5rem 1rem;
      color: var(--text-muted);
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="header-top">
        <div>
          <h1>Musement</h1>
          <p class="subtitle">Knowledge Durability Pyramid & On-Demand Curation</p>
        </div>
      </div>
      <div class="rss-links">
        <a href="${escapeHtml(curatedFeedUrl)}" class="rss-btn" target="_blank">📡 Curated Feed (RSS)</a>
        <a href="${escapeHtml(evergreenFeedUrl)}" class="rss-btn" target="_blank">🌳 Evergreen Feed (${evergreenCount})</a>
        <a href="${escapeHtml(emergingFeedUrl)}" class="rss-btn" target="_blank">⚡ Emerging Feed (${emergingCount})</a>
        <a href="${escapeHtml(horizonFeedUrl)}" class="rss-btn" target="_blank">🌅 Horizon Feed (${horizonCount})</a>
      </div>
    </header>

    <div class="tabs">
      <button class="tab-btn active" onclick="switchTab('curated')">Curated Encounters (${encounters.reduce((acc, e) => acc + e.discoveries.length, 0)})</button>
      <button class="tab-btn" onclick="switchTab('pool')">Candidate Pool (${poolMaterials.length})</button>
    </div>

    <main>
      <section id="tab-curated" class="tab-content active">
        ${curatedCardsHtml || '<div class="empty-state">No curated encounters yet. Run <code>musement pull [question/topic]</code> to select discoveries.</div>'}
      </section>

      <section id="tab-pool" class="tab-content">
        <div class="toolbar">
          <div class="filter-group">
            <span class="filter-label">Pyramid</span>
            <button class="pill-btn active" onclick="setTierFilter('all', this)">All (${poolMaterials.length})</button>
            <button class="pill-btn pill-evergreen" onclick="setTierFilter('evergreen', this)">🌳 Evergreen (${evergreenCount})</button>
            <button class="pill-btn pill-emerging" onclick="setTierFilter('emerging', this)">⚡ Emerging (${emergingCount})</button>
            <button class="pill-btn pill-horizon" onclick="setTierFilter('horizon', this)">🌅 Horizon (${horizonCount})</button>
          </div>

          <div class="filter-group">
            <span class="filter-label">Source</span>
            <button class="pill-btn active" onclick="setSourceFilter('all', this)">All Sources</button>
            ${sources
              .map(
                (s) =>
                  `<button class="pill-btn" onclick="setSourceFilter('${escapeHtml(s.id)}', this)">${escapeHtml(s.name)}</button>`,
              )
              .join("\n            ")}
          </div>

          <div class="sort-bar">
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <span class="filter-label">Sort</span>
              <select id="sort-select" class="select-control" onchange="setSortMode(this.value)">
                <option value="shuffle">🎲 Daily Seeded Shuffle</option>
                <option value="newest">⏱️ Newest Published</option>
                <option value="interleave">🔀 Fair Interleaved (by Source)</option>
              </select>
            </div>
            <button id="reshuffle-btn" class="btn btn-outline" onclick="triggerReshuffle()">🎲 Reshuffle</button>
          </div>
        </div>

        <div id="pool-cards-container"></div>
      </section>
    </main>
  </div>

  <script id="pool-data" type="application/json">
${poolDataJson}
  </script>

  <script>
    let currentTier = 'all';
    let currentSource = 'all';
    let currentSort = 'shuffle';
    let shuffleSeedOffset = 0;

    const rawPoolData = JSON.parse(document.getElementById('pool-data').textContent);

    function switchTab(name) {
      document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      if (name === 'curated') {
        document.querySelector('.tab-btn:nth-child(1)').classList.add('active');
        document.getElementById('tab-curated').classList.add('active');
      } else {
        document.querySelector('.tab-btn:nth-child(2)').classList.add('active');
        document.getElementById('tab-pool').classList.add('active');
        renderPoolCards();
      }
    }

    function setTierFilter(tier, btn) {
      currentTier = tier;
      btn.parentElement.querySelectorAll('.pill-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderPoolCards();
    }

    function setSourceFilter(sourceId, btn) {
      currentSource = sourceId;
      btn.parentElement.querySelectorAll('.pill-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderPoolCards();
    }

    function setSortMode(mode) {
      currentSort = mode;
      document.getElementById('reshuffle-btn').style.display = mode === 'shuffle' ? 'inline-flex' : 'none';
      renderPoolCards();
    }

    function triggerReshuffle() {
      shuffleSeedOffset = Math.floor(Math.random() * 100000) + 1;
      renderPoolCards();
    }

    function pseudoRandom(seed) {
      let t = seed += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }

    function renderPoolCards() {
      const container = document.getElementById('pool-cards-container');
      let items = [...rawPoolData];

      if (currentTier !== 'all') {
        items = items.filter(item => item.durabilityTier === currentTier);
      }

      if (currentSource !== 'all') {
        items = items.filter(item => item.sourceId === currentSource);
      }

      if (currentSort === 'newest') {
        items.sort((a, b) => Date.parse(b.publishedAt || b.fetchedAt) - Date.parse(a.publishedAt || a.fetchedAt));
      } else if (currentSort === 'interleave') {
        const bySource = new Map();
        for (const item of items) {
          if (!bySource.has(item.sourceId)) bySource.set(item.sourceId, []);
          bySource.get(item.sourceId).push(item);
        }
        for (const list of bySource.values()) {
          list.sort((a, b) => Date.parse(b.publishedAt || b.fetchedAt) - Date.parse(a.publishedAt || a.fetchedAt));
        }
        const interleaved = [];
        const sourceLists = [...bySource.values()];
        let maxLen = Math.max(0, ...sourceLists.map(l => l.length));
        for (let i = 0; i < maxLen; i++) {
          for (const list of sourceLists) {
            if (i < list.length) interleaved.push(list[i]);
          }
        }
        items = interleaved;
      } else {
        // Daily seeded shuffle + offset
        const todayStr = new Date().toISOString().slice(0, 10);
        let baseSeed = 0;
        for (let i = 0; i < todayStr.length; i++) baseSeed = (baseSeed * 31 + todayStr.charCodeAt(i)) | 0;
        baseSeed += shuffleSeedOffset;

        items = items.map((item, idx) => ({
          item,
          rand: pseudoRandom(baseSeed + idx * 997 + item.fingerprint.charCodeAt(0))
        })).sort((a, b) => a.rand - b.rand).map(x => x.item);
      }

      if (items.length === 0) {
        container.innerHTML = '<div class="empty-state">No candidate materials match the selected filters.</div>';
        return;
      }

      container.innerHTML = items.map(item => {
        const tierBadgeClass = item.durabilityTier === 'evergreen' ? 'badge-evergreen'
          : item.durabilityTier === 'emerging' ? 'badge-emerging' : 'badge-horizon';
        const tierLabel = item.durabilityTier.toUpperCase();
        const pubDate = new Date(item.publishedAt || item.fetchedAt).toLocaleDateString();

        return \`
        <article class="card">
          <div class="card-meta">
            <span class="badge \${tierBadgeClass}">\${tierLabel}</span>
            <span class="badge badge-source">\${escapeHtml(item.sourceName)}</span>
            <span class="badge badge-muted">\${escapeHtml(item.format)} · \${item.estimatedMinutes} min</span>
            <span class="timestamp">\${pubDate}</span>
          </div>
          <h2 class="card-title">
            <a href="\${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">\${escapeHtml(item.title)}</a>
          </h2>
          <p class="card-summary">\${escapeHtml(item.summary)}</p>
          <div class="card-footer">
            <span class="source-tag">Author: \${escapeHtml(item.author)}</span>
            <div class="card-actions">
              <a href="\${escapeHtml(item.url)}" class="btn btn-outline" target="_blank" rel="noopener noreferrer">📖 Read</a>
              <a href="\${escapeHtml(item.callbackUrl)}" class="btn btn-primary" target="_blank" rel="noopener noreferrer">✅ Mark as Read</a>
            </div>
          </div>
        </article>\`;
      }).join('\\n');
    }

    function escapeHtml(unsafe) {
      if (!unsafe) return '';
      return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    // Initial render
    renderPoolCards();
  </script>
</body>
</html>`;
  }

  async #gitCommitAndPush(targetDir: string): Promise<void> {
    try {
      await execFileAsync("git", ["add", "musement"], {
        cwd: this.#config.repo_path,
      });
      await execFileAsync(
        "git",
        ["commit", "-m", "chore(musement): update RSS feeds and exposures"],
        { cwd: this.#config.repo_path },
      );
      await execFileAsync("git", ["push"], { cwd: this.#config.repo_path });
    } catch {
      // Ignore if no changes to commit or remote push fails temporarily
    }
  }
}

function makeIssueCallbackUrl(fingerprint: string, title: string): string {
  const issueTitle = encodeURIComponent(`Musement Read: ${fingerprint}`);
  const issueBody = encodeURIComponent(
    `Item: "${title}"\nFingerprint: ${fingerprint}\n\nSubmit this issue to mark this material as read in Musement.`,
  );
  return `https://github.com/ZhengHe-MD/ZhengHe-MD.github.io/issues/new?title=${issueTitle}&body=${issueBody}`;
}

function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "'":
        return "&apos;";
      case '"':
        return "&quot;";
      default:
        return c;
    }
  });
}

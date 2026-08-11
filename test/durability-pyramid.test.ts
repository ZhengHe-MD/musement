import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { Musement } from "../src/application/musement.js";
import {
  DurabilityClassifier,
  heuristicClassification,
} from "../src/application/durability-classifier.js";
import {
  OnlinePullEditor,
  extractKeywords,
  sampleByKeywordsAndRelevance,
  sampleStratifiedByTier,
} from "../src/application/online-pull-editor.js";
import type {
  CandidatePoolItem,
  DailyEditionDraft,
  EditionEditor,
} from "../src/domain/contracts.js";
import { SqliteMusementStore } from "../src/infrastructure/sqlite-musement-store.js";
import { GitHubRssPublisher } from "../src/infrastructure/github-rss-publisher.js";
import type { StructuredProvider } from "../src/infrastructure/codex-app-server-provider.js";
import { defaultConfiguration } from "../src/config/configuration.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("Knowledge Durability Pyramid & Two-Stage Curation", () => {
  it("classifies materials by heuristic and AI provider", async () => {
    const horizonItem: CandidatePoolItem = {
      fingerprint: "h-1",
      sourceId: "news",
      sourceName: "Tech News",
      title: "Announcing v2.0 Release Notes",
      url: "https://example.com/v2",
      author: null,
      publishedAt: "2026-08-11T10:00:00Z",
      fetchedAt: "2026-08-11T10:00:00Z",
      summary: "Breaking: v2.0 launch with new features.",
      content: "Details about the launch.",
      estimatedMinutes: 3,
      format: "article",
      durabilityTier: "horizon",
      provenance: [],
      referencedUrls: [],
      isExposed: false,
      exposedAt: null,
    };

    const evergreenItem: CandidatePoolItem = {
      fingerprint: "e-1",
      sourceId: "classics",
      sourceName: "Classic Essays",
      title: "Foundations of Computer Systems",
      url: "https://example.com/systems",
      author: "Prof. Smith",
      publishedAt: "2015-05-01T10:00:00Z",
      fetchedAt: "2026-08-11T10:00:00Z",
      summary: "Enduring principles and mental models of computer architecture.",
      content: "Deep timeless principles...",
      estimatedMinutes: 45,
      format: "lecture",
      durabilityTier: "evergreen",
      provenance: [],
      referencedUrls: [],
      isExposed: false,
      exposedAt: null,
    };

    expect(heuristicClassification(horizonItem)).toBe("horizon");
    expect(heuristicClassification(evergreenItem)).toBe("evergreen");

    const classifier = new DurabilityClassifier();
    const results = await classifier.classifyMaterials([horizonItem, evergreenItem]);
    expect(results.get("h-1")).toBe("horizon");
    expect(results.get("e-1")).toBe("evergreen");
  });

  it("stores durability tiers in SQLite and supports tier-based queries & keyword search", async () => {
    const directory = await mkdtemp(join(tmpdir(), "musement-db-tier-"));
    temporaryDirectories.push(directory);
    const store = new SqliteMusementStore(join(directory, "musement.sqlite"));

    const item1: CandidatePoolItem = {
      fingerprint: "fp-eg-1",
      sourceId: "source-books",
      sourceName: "Classic Books",
      title: "Structure and Interpretation of Computer Programs",
      url: "https://example.com/sicp",
      author: "Abelson & Sussman",
      publishedAt: "1984-01-01T00:00:00Z",
      fetchedAt: "2026-08-11T00:00:00Z",
      summary: "Foundational computer science principles and abstraction techniques.",
      content: "Deep modularity and procedural abstraction...",
      estimatedMinutes: 60,
      format: "paper",
      durabilityTier: "evergreen",
      provenance: ["https://example.com"],
      referencedUrls: [],
      isExposed: false,
      exposedAt: null,
    };

    const item2: CandidatePoolItem = {
      fingerprint: "fp-em-1",
      sourceId: "source-podcasts",
      sourceName: "Dwarkesh Podcast",
      title: "Deep Dive into Transformer Scaling Laws",
      url: "https://example.com/dwarkesh-transformers",
      author: "Dwarkesh Patel",
      publishedAt: "2026-07-20T00:00:00Z",
      fetchedAt: "2026-08-11T00:00:00Z",
      summary: "Multi-year architectural paradigm shifts in neural computation.",
      content: "Scaling limits, compute thresholds, and memory bottlenecks...",
      estimatedMinutes: 90,
      format: "podcast",
      durabilityTier: "emerging",
      provenance: ["https://example.com"],
      referencedUrls: [],
      isExposed: false,
      exposedAt: null,
    };

    const item3: CandidatePoolItem = {
      fingerprint: "fp-hz-1",
      sourceId: "source-hn",
      sourceName: "Hacker News",
      title: "Show HN: Fast local SQLite UI tool",
      url: "https://example.com/show-hn",
      author: "dev123",
      publishedAt: "2026-08-11T08:00:00Z",
      fetchedAt: "2026-08-11T08:00:00Z",
      summary: "A small lightweight utility released today.",
      content: "Check out my new weekend project...",
      estimatedMinutes: 4,
      format: "article",
      durabilityTier: "horizon",
      provenance: ["https://example.com"],
      referencedUrls: [],
      isExposed: false,
      exposedAt: null,
    };

    store.savePoolMaterials([item1, item2, item3]);

    const allUnexposed = store.listUnexposedPoolMaterials();
    expect(allUnexposed).toHaveLength(3);

    const evergreenOnly = store.listUnexposedPoolMaterials(undefined, "evergreen");
    expect(evergreenOnly).toHaveLength(1);
    expect(evergreenOnly[0]?.title).toContain("Structure and Interpretation");
    expect(evergreenOnly[0]?.durabilityTier).toBe("evergreen");

    const emergingOnly = store.listUnexposedPoolMaterials(undefined, "emerging");
    expect(emergingOnly).toHaveLength(1);
    expect(emergingOnly[0]?.title).toContain("Transformer Scaling Laws");
    expect(emergingOnly[0]?.durabilityTier).toBe("emerging");

    const horizonOnly = store.listUnexposedPoolMaterials(undefined, "horizon");
    expect(horizonOnly).toHaveLength(1);
    expect(horizonOnly[0]?.title).toContain("Show HN");
    expect(horizonOnly[0]?.durabilityTier).toBe("horizon");

    // Test Keyword Search
    const searchResults = store.searchUnexposedPoolMaterials(["transformer", "scaling"]);
    expect(searchResults).toHaveLength(1);
    expect(searchResults[0]?.fingerprint).toBe("fp-em-1");

    store.close();
  });

  it("extracts keywords and samples candidates for two-stage curation", () => {
    const keywords = extractKeywords(
      "What are the latest breakthroughs in transformer scaling and agent memory architectures?",
    );
    expect(keywords).toContain("transformer");
    expect(keywords).toContain("scaling");
    expect(keywords).toContain("agent");
    expect(keywords).toContain("memory");
    expect(keywords).toContain("architectures");
    expect(keywords).not.toContain("what");
    expect(keywords).not.toContain("are");
    expect(keywords).not.toContain("the");

    const items: CandidatePoolItem[] = [
      {
        fingerprint: "m-1",
        sourceId: "s1",
        sourceName: "AI Weekly",
        title: "Agent Memory Architectures and Working State",
        url: "https://example.com/1",
        author: "A",
        publishedAt: "2026-08-01",
        fetchedAt: "2026-08-01",
        summary: "Memory design for autonomous agents.",
        content: "Detailed memory architectures...",
        estimatedMinutes: 10,
        format: "article",
        durabilityTier: "emerging",
        provenance: [],
        referencedUrls: [],
        isExposed: false,
        exposedAt: null,
      },
      {
        fingerprint: "m-2",
        sourceId: "s2",
        sourceName: "Nature",
        title: "Deep Sea Microbial Ecology",
        url: "https://example.com/2",
        author: "B",
        publishedAt: "2026-08-01",
        fetchedAt: "2026-08-01",
        summary: "Ocean floor bacteria discoveries.",
        content: "Microbial genetics...",
        estimatedMinutes: 15,
        format: "article",
        durabilityTier: "evergreen",
        provenance: [],
        referencedUrls: [],
        isExposed: false,
        exposedAt: null,
      },
    ];

    const sampled = sampleByKeywordsAndRelevance({
      poolMaterials: items,
      query: "agent memory architectures",
      limit: 10,
    });

    expect(sampled[0]?.fingerprint).toBe("m-1");
  });

  it("exports multi-tier RSS feeds and interactive HTML portal with Durability Pyramid filters", async () => {
    const directory = await mkdtemp(join(tmpdir(), "musement-publisher-tier-"));
    temporaryDirectories.push(directory);

    const publisher = new GitHubRssPublisher({
      repo_path: directory,
      publish_dir: "musement",
      site_base_url: "https://zhenghe-md.github.io/musement",
      auto_push: false,
    });

    const poolItems: CandidatePoolItem[] = [
      {
        fingerprint: "fp-eg",
        sourceId: "src-books",
        sourceName: "Classics",
        title: "Timeless Math Principles",
        url: "https://example.com/math",
        author: "Gauss",
        publishedAt: "2020-01-01T00:00:00Z",
        fetchedAt: "2026-08-11T00:00:00Z",
        summary: "Enduring mathematical structures.",
        content: "Math foundations...",
        estimatedMinutes: 25,
        format: "article",
        durabilityTier: "evergreen",
        provenance: [],
        referencedUrls: [],
        isExposed: false,
        exposedAt: null,
      },
      {
        fingerprint: "fp-em",
        sourceId: "src-podcasts",
        sourceName: "Dwarkesh Patel",
        title: "Deep Dive Podcast on LLM Reasoning",
        url: "https://example.com/dwarkesh",
        author: "Dwarkesh Patel",
        publishedAt: "2026-08-05T00:00:00Z",
        fetchedAt: "2026-08-11T00:00:00Z",
        summary: "Multi-year paradigm shift discussion.",
        content: "Podcast dialogue on compute...",
        estimatedMinutes: 80,
        format: "podcast",
        durabilityTier: "emerging",
        provenance: [],
        referencedUrls: [],
        isExposed: false,
        exposedAt: null,
      },
      {
        fingerprint: "fp-hz",
        sourceId: "src-news",
        sourceName: "Tech News",
        title: "Release v3.1 Announced",
        url: "https://example.com/v31",
        author: "Reporter",
        publishedAt: "2026-08-11T05:00:00Z",
        fetchedAt: "2026-08-11T05:00:00Z",
        summary: "Daily release tangent.",
        content: "New update details...",
        estimatedMinutes: 3,
        format: "article",
        durabilityTier: "horizon",
        provenance: [],
        referencedUrls: [],
        isExposed: false,
        exposedAt: null,
      },
    ];

    const result = await publisher.publish({
      curatedEncounters: [],
      poolMaterials: poolItems,
    });

    expect(result.curatedXmlPath).toContain("curated.xml");
    expect(result.evergreenXmlPath).toContain("pool-evergreen.xml");
    expect(result.emergingXmlPath).toContain("pool-emerging.xml");
    expect(result.horizonXmlPath).toContain("pool-horizon.xml");
    expect(result.poolXmlPath).toContain("pool.xml");

    const evergreenXml = await readFile(result.evergreenXmlPath, "utf8");
    expect(evergreenXml).toContain("Musement Evergreen Candidates");
    expect(evergreenXml).toContain("Timeless Math Principles");
    expect(evergreenXml).not.toContain("Release v3.1 Announced");

    const emergingXml = await readFile(result.emergingXmlPath, "utf8");
    expect(emergingXml).toContain("Musement Emerging Candidates");
    expect(emergingXml).toContain("Deep Dive Podcast on LLM Reasoning");

    const horizonXml = await readFile(result.horizonXmlPath, "utf8");
    expect(horizonXml).toContain("Musement Horizon Candidates");
    expect(horizonXml).toContain("Release v3.1 Announced");

    const indexHtml = await readFile(result.indexPath, "utf8");
    expect(indexHtml).toContain("Knowledge Durability Pyramid");
    expect(indexHtml).toContain("🌳 Evergreen");
    expect(indexHtml).toContain("⚡ Emerging");
    expect(indexHtml).toContain("🌅 Horizon");
    expect(indexHtml).toContain("🎲 Daily Seeded Shuffle");
    expect(indexHtml).toContain("🔀 Fair Interleaved");
  });
});

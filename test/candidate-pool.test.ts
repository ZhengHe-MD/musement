import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { Musement } from "../src/application/musement.js";
import type {
  CandidatePoolItem,
  DailyEditionDraft,
  EditionEditor,
} from "../src/domain/contracts.js";
import { SqliteMusementStore } from "../src/infrastructure/sqlite-musement-store.js";
import { GitHubRssPublisher } from "../src/infrastructure/github-rss-publisher.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("Candidate Pool & On-Demand Pull", () => {
  it("saves candidates to pool and queries unexposed materials by source or globally", async () => {
    const directory = await mkdtemp(join(tmpdir(), "musement-pool-"));
    temporaryDirectories.push(directory);
    const store = new SqliteMusementStore(join(directory, "musement.sqlite"));

    const item1: CandidatePoolItem = {
      fingerprint: "fp-1",
      sourceId: "source-a",
      sourceName: "Source A",
      title: "Quantum Breakthrough",
      url: "https://example.com/quantum",
      author: "Dr. Alice",
      publishedAt: "2026-08-01T10:00:00Z",
      fetchedAt: "2026-08-09T08:00:00Z",
      summary: "A major breakthrough in quantum computing.",
      content: "Detailed substance about quantum computing...",
      estimatedMinutes: 8,
      format: "article",
      provenance: ["https://example.com/feed.xml"],
      referencedUrls: [],
      isExposed: false,
      exposedAt: null,
    };

    const item2: CandidatePoolItem = {
      fingerprint: "fp-2",
      sourceId: "source-b",
      sourceName: "Source B",
      title: "New AI Architecture",
      url: "https://example.com/ai",
      author: "Bob",
      publishedAt: "2026-08-02T10:00:00Z",
      fetchedAt: "2026-08-09T08:05:00Z",
      summary: "A novel neural network design.",
      content: "Substance on AI architecture...",
      estimatedMinutes: 12,
      format: "paper",
      provenance: ["https://example.com/feed-b.xml"],
      referencedUrls: [],
      isExposed: false,
      exposedAt: null,
    };

    store.savePoolMaterials([item1, item2]);

    const allUnexposed = store.listUnexposedPoolMaterials();
    expect(allUnexposed).toHaveLength(2);

    const sourceAUnexposed = store.listUnexposedPoolMaterials("source-a");
    expect(sourceAUnexposed).toHaveLength(1);
    expect(sourceAUnexposed[0]?.title).toBe("Quantum Breakthrough");

    const summary = store.listPoolSourcesSummary();
    expect(summary).toEqual([
      { sourceId: "source-a", sourceName: "Source A", totalItems: 1, unexposedItems: 1 },
      { sourceId: "source-b", sourceName: "Source B", totalItems: 1, unexposedItems: 1 },
    ]);

    // Mark item1 exposed
    store.markPoolMaterialsExposed(["fp-1"], "2026-08-09T10:00:00Z");
    expect(store.listUnexposedPoolMaterials()).toHaveLength(1);
    expect(store.listUnexposedPoolMaterials("source-a")).toHaveLength(0);

    // Mark source-b exposed
    store.markSourceExposed("source-b", "2026-08-09T10:05:00Z");
    expect(store.listUnexposedPoolMaterials()).toHaveLength(0);

    store.close();
  });

  it("pullCurated selects on-demand discoveries, marks them exposed, and saves encounters", async () => {
    const directory = await mkdtemp(join(tmpdir(), "musement-pull-"));
    temporaryDirectories.push(directory);
    const store = new SqliteMusementStore(join(directory, "musement.sqlite"));

    const item: CandidatePoolItem = {
      fingerprint: "fp-10",
      sourceId: "source-c",
      sourceName: "Source C",
      title: "Biotechnology Discovery",
      url: "https://example.com/biotech",
      author: "Carol",
      publishedAt: "2026-08-05T10:00:00Z",
      fetchedAt: "2026-08-09T08:00:00Z",
      summary: "Biotech breakthrough.",
      content: "Substance on biotech...",
      estimatedMinutes: 5,
      format: "article",
      provenance: ["https://example.com/feed.xml"],
      referencedUrls: [],
      isExposed: false,
      exposedAt: null,
    };
    store.savePoolMaterials([item]);

    const dummyEditor: EditionEditor = {
      generate: async (): Promise<DailyEditionDraft> => {
        throw new Error("not used for pull");
      },
    };

    const musement = new Musement({
      store,
      editor: dummyEditor,
      clock: { now: () => new Date("2026-08-09T12:00:00Z") },
      timezone: "Asia/Shanghai",
    });

    const encounter = await musement.pullCurated({ count: 1, direction: "Biotechnology" });
    expect(encounter.count).toBe(1);
    expect(encounter.discoveries[0]?.title).toBe("Biotechnology Discovery");
    expect(encounter.direction).toBe("Biotechnology");

    // Item should now be exposed
    expect(store.listUnexposedPoolMaterials()).toHaveLength(0);
    expect(store.listCuratedEncounters()).toHaveLength(1);

    store.close();
  });

  it("GitHubRssPublisher exports valid RSS XML and syncs remote exposures", async () => {
    const directory = await mkdtemp(join(tmpdir(), "musement-github-pages-"));
    temporaryDirectories.push(directory);

    const publisher = new GitHubRssPublisher({
      repo_path: directory,
      publish_dir: "musement",
      site_base_url: "https://zhenghe-md.github.io/musement",
      auto_push: false,
    });

    const poolItem: CandidatePoolItem = {
      fingerprint: "fp-test-rss",
      sourceId: "source-rss",
      sourceName: "Tech News",
      title: "New RSS Feature",
      url: "https://example.com/rss-feature",
      author: "Editor",
      publishedAt: "2026-08-09T12:00:00Z",
      fetchedAt: "2026-08-09T12:00:00Z",
      summary: "RSS feed publishing explanation.",
      content: "Content about RSS publishing.",
      estimatedMinutes: 4,
      format: "article",
      provenance: ["https://example.com/feed.xml"],
      referencedUrls: [],
      isExposed: false,
      exposedAt: null,
    };

    const result = await publisher.publish({
      curatedEncounters: [],
      poolMaterials: [poolItem],
    });

    expect(result.curatedXmlPath).toContain("curated.xml");
    expect(result.poolXmlPath).toContain("pool.xml");

    const poolXmlContent = await readFile(result.poolXmlPath, "utf8");
    expect(poolXmlContent).toContain("<title>Musement Candidate Pool</title>");
    expect(poolXmlContent).toContain("New RSS Feature");
    expect(poolXmlContent).toContain("Mark as Read in Musement");

    // Simulate remote exposure write to exposures.json
    const exposuresPath = join(directory, "musement", "exposures.json");
    await writeFile(
      exposuresPath,
      JSON.stringify([{ fingerprint: "fp-test-rss", exposed_at: "2026-08-09T14:00:00Z" }]),
      "utf8",
    );

    const synced = await publisher.syncRemoteExposures();
    expect(synced).toEqual([
      { fingerprint: "fp-test-rss", exposed_at: "2026-08-09T14:00:00Z" },
    ]);
  });
});

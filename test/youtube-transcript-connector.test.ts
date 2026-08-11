import { describe, expect, it } from "vitest";

import type { CollectedMaterial } from "../src/domain/contracts.js";
import {
  TranscriptEnrichingCollector,
  YouTubeTranscriptConnector,
  videoIdFromUrl,
  type StoredTranscript,
  type TranscriptStore,
} from "../src/infrastructure/youtube-transcript-connector.js";

class MemoryTranscriptStore implements TranscriptStore {
  readonly records = new Map<string, StoredTranscript>();
  findTranscript(videoId: string): StoredTranscript | null {
    return this.records.get(videoId) ?? null;
  }
  saveTranscript(record: StoredTranscript): void {
    this.records.set(record.videoId, record);
  }
}

function playerResponse(options: {
  lengthSeconds: number;
  tracks?: Array<{ baseUrl: string; languageCode: string; kind?: string }>;
}): Response {
  const captions =
    options.tracks === undefined
      ? {}
      : {
          captions: {
            playerCaptionsTracklistRenderer: { captionTracks: options.tracks },
          },
        };
  return new Response(
    JSON.stringify({
      videoDetails: { lengthSeconds: String(options.lengthSeconds) },
      ...captions,
    }),
    { status: 200 },
  );
}

const timedText = `<?xml version="1.0" encoding="utf-8" ?><timedtext format="3">
  <body>
    <p t="0" d="1896">Claude Shannon measured how compressible English is</p>
    <p t="1896" d="2547">by testing how predictable each next letter turns out to be.</p>
  </body>
</timedtext>`;

function videoMaterial(videoId: string): CollectedMaterial {
  return {
    id: videoId,
    fingerprint: videoId.padEnd(64, "0"),
    title: "Measuring the entropy of English",
    url: `https://www.youtube.com/watch?v=${videoId}`,
    author: "3Blue1Brown",
    publishedAt: "2026-07-17T00:00:00.000Z",
    format: "video",
    summary: "Short promo blurb.",
    content: "Short promo blurb.",
    estimatedMinutes: 1,
    source: { id: "yt-3blue1brown", name: "3Blue1Brown" },
    provenance: [
      "https://www.youtube.com/feeds/videos.xml?channel_id=UCexample",
      `https://www.youtube.com/watch?v=${videoId}`,
    ],
    referencedUrls: [],
  };
}

describe("YouTube transcript enrichment", () => {
  it("replaces the promo description with the caption transcript and real length", async () => {
    const store = new MemoryTranscriptStore();
    const calls: string[] = [];
    const fetcher = async (input: string) => {
      calls.push(input);
      return input.includes("/player")
        ? playerResponse({
            lengthSeconds: 1980,
            tracks: [
              { baseUrl: "https://caption.example/track", languageCode: "en" },
            ],
          })
        : new Response(timedText, { status: 200 });
    };
    const connector = new YouTubeTranscriptConnector(store, fetcher, () =>
      new Date("2026-07-18T08:00:00.000Z"),
    );

    const [material] = await connector.enrich([videoMaterial("abcdefghijk")]);

    expect(material?.content).toContain("Claude Shannon measured how compressible");
    expect(material?.content).not.toContain("promo blurb");
    expect(material?.estimatedMinutes).toBe(33);
    expect(store.findTranscript("abcdefghijk")?.status).toBe("available");
  });

  it("reuses a stored transcript without fetching again", async () => {
    const store = new MemoryTranscriptStore();
    store.saveTranscript({
      videoId: "abcdefghijk",
      fetchedAt: "2026-01-01T00:00:00.000Z",
      status: "available",
      language: "en",
      durationSeconds: 1980,
      transcript: "A previously resolved transcript kept for reuse forever.",
    });
    let fetches = 0;
    const connector = new YouTubeTranscriptConnector(
      store,
      async () => {
        fetches += 1;
        return new Response("{}", { status: 200 });
      },
      () => new Date("2026-07-18T08:00:00.000Z"),
    );

    const [material] = await connector.enrich([videoMaterial("abcdefghijk")]);

    expect(fetches).toBe(0);
    expect(material?.content).toContain("previously resolved transcript");
    expect(material?.estimatedMinutes).toBe(33);
  });

  it("keeps the description but corrects length when a video has no captions", async () => {
    const store = new MemoryTranscriptStore();
    const connector = new YouTubeTranscriptConnector(
      store,
      async (input) =>
        input.includes("/player")
          ? playerResponse({ lengthSeconds: 1200 })
          : new Response("", { status: 200 }),
      () => new Date("2026-07-18T08:00:00.000Z"),
    );

    const [material] = await connector.enrich([videoMaterial("nocaptions01")]);

    expect(material?.content).toBe("Short promo blurb.");
    expect(material?.estimatedMinutes).toBe(20);
    expect(store.findTranscript("nocaptions01")?.status).toBe("unavailable");
  });

  it("leaves a Material untouched and unstored on a transient failure", async () => {
    const store = new MemoryTranscriptStore();
    const connector = new YouTubeTranscriptConnector(
      store,
      async () => new Response("upstream error", { status: 503 }),
      () => new Date("2026-07-18T08:00:00.000Z"),
    );

    const [material] = await connector.enrich([videoMaterial("transient01")]);

    expect(material?.content).toBe("Short promo blurb.");
    expect(material?.estimatedMinutes).toBe(1);
    expect(store.findTranscript("transient01")).toBeNull();
  });

  it("does not touch non-video Materials", async () => {
    const store = new MemoryTranscriptStore();
    let fetches = 0;
    const connector = new YouTubeTranscriptConnector(store, async () => {
      fetches += 1;
      return new Response("{}", { status: 200 });
    });
    const article: CollectedMaterial = {
      ...videoMaterial("ignored0001"),
      format: "article",
      url: "https://example.com/essay",
    };

    const [material] = await connector.enrich([article]);

    expect(fetches).toBe(0);
    expect(material).toBe(article);
  });

  it("enriches through a wrapped collector before eligibility is assessed", async () => {
    const store = new MemoryTranscriptStore();
    const base = {
      collect: async () => [videoMaterial("abcdefghijk")],
    };
    const connector = new YouTubeTranscriptConnector(
      store,
      async (input) =>
        input.includes("/player")
          ? playerResponse({
              lengthSeconds: 1980,
              tracks: [
                { baseUrl: "https://caption.example/track", languageCode: "en" },
              ],
            })
          : new Response(timedText, { status: 200 }),
      () => new Date("2026-07-18T08:00:00.000Z"),
    );
    const collector = new TranscriptEnrichingCollector(base, connector);

    const [material] = await collector.collect([]);

    expect(material?.content).toContain("Claude Shannon");
    expect(collector.broaden).toBeUndefined();
  });
});

describe("videoIdFromUrl", () => {
  it("extracts ids from watch, youtu.be, and shorts URLs", () => {
    expect(videoIdFromUrl("https://www.youtube.com/watch?v=abcdefghijk")).toBe(
      "abcdefghijk",
    );
    expect(videoIdFromUrl("https://youtu.be/abcdefghijk")).toBe("abcdefghijk");
    expect(videoIdFromUrl("https://www.youtube.com/shorts/abcdefghijk")).toBe(
      "abcdefghijk",
    );
  });

  it("returns null for non-YouTube or malformed URLs", () => {
    expect(videoIdFromUrl("https://example.com/watch?v=abcdefghijk")).toBeNull();
    expect(videoIdFromUrl("not a url")).toBeNull();
  });
});

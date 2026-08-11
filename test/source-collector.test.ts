import { describe, expect, it } from "vitest";

import type { ConfiguredSource } from "../src/config/configuration.js";
import {
  PublicSourceCollector,
  createSourceFetcher,
  resolveProxyUrl,
  safePublicFetch,
} from "../src/infrastructure/public-source-collector.js";

describe("public Source Portfolio collection", () => {
  it("normalizes and deduplicates public feed Materials with provenance", async () => {
    const source: ConfiguredSource = {
      id: "example-feed",
      name: "Example Feed",
      kind: "rss",
      url: "https://example.com/feed.xml",
      enabled: true,
    };
    const fetcher = async () =>
      new Response(
        `<?xml version="1.0"?>
        <rss version="2.0"><channel><title>Example Feed</title>
          <item>
            <title>A consequential discovery</title>
            <link>https://example.com/discovery</link>
            <guid>discovery-1</guid>
            <author>Example Author</author>
            <pubDate>Fri, 17 Jul 2026 12:00:00 GMT</pubDate>
            <description>A sufficiently informative description of the discovery and why it may matter to readers around the world.</description>
          </item>
          <item>
            <title>A consequential discovery</title>
            <link>https://example.com/discovery</link>
            <description>Duplicate syndication entry.</description>
          </item>
        </channel></rss>`,
        { status: 200, headers: { "content-type": "application/rss+xml" } },
      );
    const collector = new PublicSourceCollector(fetcher);

    const materials = await collector.collect([source]);

    expect(materials).toHaveLength(1);
    expect(materials[0]).toMatchObject({
      title: "A consequential discovery",
      url: "https://example.com/discovery",
      author: "Example Author",
      source: { id: "example-feed", name: "Example Feed" },
      provenance: [
        "https://example.com/feed.xml",
        "https://example.com/discovery",
      ],
    });
    expect(materials[0]?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("collects standard JSON Feed Materials from a public API", async () => {
    const source: ConfiguredSource = {
      id: "example-json",
      name: "Example JSON Feed",
      kind: "json-feed",
      url: "https://example.com/feed.json",
      enabled: true,
    };
    const collector = new PublicSourceCollector(async () =>
      Response.json({
        version: "https://jsonfeed.org/version/1.1",
        items: [
          {
            id: "item-1",
            url: "https://example.com/json-discovery",
            title: "A discovery from a public API",
            content_text:
              "A substantive public API description with context, evidence, and enough detail for editorial assessment by Musement.",
            authors: [{ name: "API Author" }],
            date_published: "2026-07-17T00:00:00Z",
          },
        ],
      }),
    );

    const materials = await collector.collect([source]);

    expect(materials[0]).toMatchObject({
      title: "A discovery from a public API",
      author: "API Author",
      url: "https://example.com/json-discovery",
    });
  });

  it("extracts an ordinary configured public web page", async () => {
    const source: ConfiguredSource = {
      id: "example-web",
      name: "Example Web",
      kind: "web",
      url: "https://example.com/essay",
      enabled: true,
    };
    const collector = new PublicSourceCollector(async () =>
      new Response(
        `<html><head><title>An illuminating public essay</title>
        <meta name="author" content="Web Author"></head>
        <body><article><p>This essay offers a substantive explanation with historical context, evidence, uncertainty, and enough detail to support editorial consideration.</p></article></body></html>`,
        { headers: { "content-type": "text/html" } },
      ),
    );

    const materials = await collector.collect([source]);

    expect(materials[0]).toMatchObject({
      title: "An illuminating public essay",
      author: "Web Author",
      url: "https://example.com/essay",
    });
  });

  it("collects RSS 1.0 Materials that sit beside the channel", async () => {
    const source: ConfiguredSource = {
      id: "example-rdf",
      name: "Example RDF Feed",
      kind: "rss",
      url: "https://example.com/rdf.xml",
      enabled: true,
    };
    const collector = new PublicSourceCollector(async () =>
      new Response(
        `<?xml version="1.0"?>
        <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns="http://purl.org/rss/1.0/">
          <channel rdf:about="https://example.com/rdf.xml"><title>Example RDF Feed</title></channel>
          <item rdf:about="https://example.com/rdf-discovery">
            <title>A published research result</title>
            <link>https://example.com/rdf-discovery</link>
            <dc:creator>Example Researcher</dc:creator>
            <dc:date>2026-07-17T00:00:00Z</dc:date>
            <description>A substantive abstract describing the result, its evidence, and the uncertainty that remains after peer review.</description>
          </item>
        </rdf:RDF>`,
        { status: 200, headers: { "content-type": "application/rss+xml" } },
      ),
    );

    const materials = await collector.collect([source]);

    expect(materials).toHaveLength(1);
    expect(materials[0]).toMatchObject({
      title: "A published research result",
      url: "https://example.com/rdf-discovery",
      author: "Example Researcher",
      publishedAt: "2026-07-17T00:00:00.000Z",
    });
  });

  it("collects video Materials whose description lives in a media:group", async () => {
    const source: ConfiguredSource = {
      id: "example-channel",
      name: "Example Channel",
      kind: "atom",
      url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCexample",
      enabled: true,
    };
    const collector = new PublicSourceCollector(async () =>
      new Response(
        `<?xml version="1.0"?>
        <feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/">
          <entry>
            <yt:videoId>abcdefghijk</yt:videoId>
            <title>Measuring the entropy of a language</title>
            <link rel="alternate" href="https://www.youtube.com/watch?v=abcdefghijk"/>
            <published>2026-07-17T12:00:00+00:00</published>
            <media:group>
              <media:description>A careful walk through how Claude Shannon estimated the entropy of English, why the estimate matters for compression, and what it implies about prediction.</media:description>
            </media:group>
          </entry>
        </feed>`,
        { status: 200, headers: { "content-type": "application/atom+xml" } },
      ),
    );

    const materials = await collector.collect([source]);

    expect(materials).toHaveLength(1);
    expect(materials[0]).toMatchObject({
      title: "Measuring the entropy of a language",
      url: "https://www.youtube.com/watch?v=abcdefghijk",
      format: "video",
    });
    expect(materials[0]?.content).toContain("Claude Shannon");
  });

  it("derives estimated minutes from a declared podcast duration", async () => {
    const feed = (duration: string) =>
      `<?xml version="1.0"?>
      <rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel>
        <item>
          <title>A long recorded conversation</title>
          <link>https://example.com/episode</link>
          <itunes:duration>${duration}</itunes:duration>
          <enclosure url="https://example.com/episode.mp3" length="191739073" type="audio/mpeg" />
          <description>Show notes that are far shorter than the recording they describe, which is exactly why word count cannot stand in for length.</description>
        </item>
      </channel></rss>`;
    const source: ConfiguredSource = {
      id: "example-podcast",
      name: "Example Podcast",
      kind: "rss",
      url: "https://example.com/podcast.xml",
      enabled: true,
    };

    const clock = await new PublicSourceCollector(async () =>
      new Response(feed("3:01:52"), { status: 200 }),
    ).collect([source]);
    const seconds = await new PublicSourceCollector(async () =>
      new Response(feed("5904"), { status: 200 }),
    ).collect([source]);

    expect(clock[0]).toMatchObject({ format: "podcast", estimatedMinutes: 182 });
    expect(seconds[0]).toMatchObject({ format: "podcast", estimatedMinutes: 98 });
  });

  it("falls back to word count when a feed declares no duration", async () => {
    const source: ConfiguredSource = {
      id: "example-blog",
      name: "Example Blog",
      kind: "rss",
      url: "https://example.com/blog.xml",
      enabled: true,
    };
    const collector = new PublicSourceCollector(async () =>
      new Response(
        `<?xml version="1.0"?>
        <rss version="2.0"><channel><item>
          <title>An essay without any declared duration</title>
          <link>https://example.com/essay-post</link>
          <description>${"word ".repeat(440)}</description>
        </item></channel></rss>`,
        { status: 200 },
      ),
    );

    const materials = await collector.collect([source]);

    expect(materials[0]).toMatchObject({ format: "article", estimatedMinutes: 2 });
  });

  it("stops reading a lengthless response after the 5 MB limit", async () => {
    const source: ConfiguredSource = {
      id: "oversized",
      name: "Oversized",
      kind: "web",
      url: "https://example.com/oversized",
      enabled: true,
    };
    let emitted = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        emitted += 1;
        controller.enqueue(new Uint8Array(1024 * 1024));
        if (emitted === 7) controller.close();
      },
    });
    const collector = new PublicSourceCollector(async () =>
      new Response(body, { status: 200 }),
    );

    await expect(collector.collect([source])).rejects.toThrow(
      "exceeds the 5 MB collection limit",
    );
    expect(emitted).toBeGreaterThanOrEqual(6);
  });
});

describe("source fetch proxy resolution", () => {
  it("prefers the configured proxy, then env, then none", () => {
    expect(
      resolveProxyUrl("http://127.0.0.1:7893", {
        HTTPS_PROXY: "http://env-proxy:8080",
      }),
    ).toBe("http://127.0.0.1:7893");
    expect(resolveProxyUrl(undefined, { ALL_PROXY: "http://env-proxy:8080" })).toBe(
      "http://env-proxy:8080",
    );
    expect(resolveProxyUrl(undefined, {})).toBeNull();
  });

  it("uses the direct safe fetcher when no proxy is configured", () => {
    expect(createSourceFetcher(null)).toBe(safePublicFetch);
    expect(createSourceFetcher(undefined)).toBe(safePublicFetch);
    expect(createSourceFetcher("http://127.0.0.1:7893")).not.toBe(safePublicFetch);
  });
});

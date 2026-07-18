import { describe, expect, it } from "vitest";

import type { ConfiguredSource } from "../src/config/configuration.js";
import { PublicSourceCollector } from "../src/infrastructure/public-source-collector.js";

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
});

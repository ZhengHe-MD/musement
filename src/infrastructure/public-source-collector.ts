import { createHash, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { XMLParser } from "fast-xml-parser";

import type { ConfiguredSource } from "../config/configuration.js";
import type { CollectedMaterial } from "../domain/contracts.js";

interface SourceContentCache {
  get(url: string): Promise<string | null>;
  put(url: string, body: string, retentionDays?: number): Promise<void>;
}

export type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export class PublicSourceCollector {
  readonly #fetch: Fetcher;
  readonly #cache: SourceContentCache | null;
  readonly #resolvePublicAddresses: boolean;

  constructor(fetcher: Fetcher = fetch, cache: SourceContentCache | null = null) {
    this.#fetch = fetcher;
    this.#cache = cache;
    this.#resolvePublicAddresses = fetcher === fetch;
  }

  async collect(sources: ConfiguredSource[]): Promise<CollectedMaterial[]> {
    const collected = await Promise.all(
      sources
        .filter((source) => source.enabled)
        .map((source) => this.#collectSource(source)),
    );
    const byUrl = new Map<string, CollectedMaterial>();
    for (const material of collected.flat()) {
      if (!byUrl.has(material.url)) {
        byUrl.set(material.url, material);
      }
    }
    return [...byUrl.values()];
  }

  async #collectSource(source: ConfiguredSource): Promise<CollectedMaterial[]> {
    const cachingAllowed = source.cache_retention_days !== 0;
    const cached = cachingAllowed ? await this.#cache?.get(source.url) : null;
    const body = cached ?? (await this.#fetchSource(source));
    if (cached === null && this.#cache !== null) {
      await this.#cache.put(
        source.url,
        body,
        source.cache_retention_days,
      );
    }

    if (source.kind === "rss" || source.kind === "atom") {
      return parseXmlFeed(body, source);
    }
    if (source.kind === "json-feed") {
      return parseJsonFeed(body, source);
    }
    if (source.kind === "web") {
      return parseWebPage(body, source);
    }
    throw new Error(`Source kind ${source.kind} is not implemented.`);
  }

  async #fetchSource(source: ConfiguredSource): Promise<string> {
    let currentUrl = source.url;
    for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
      await assertPublicSourceUrl(currentUrl, this.#resolvePublicAddresses);
      const response = await this.#fetch(currentUrl, {
        headers: {
          accept:
            "application/rss+xml, application/atom+xml, application/feed+json, application/json, text/html;q=0.8",
          "user-agent": "Musement/0.1 (+local personal knowledge exploration)",
        },
        redirect: "manual",
        signal: AbortSignal.timeout(20_000),
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (location === null) {
          throw new Error(`Source ${source.id} returned a redirect without a location.`);
        }
        currentUrl = new URL(location, currentUrl).href;
        continue;
      }
      if (!response.ok) {
        throw new Error(
          `Source ${source.id} returned HTTP ${response.status} ${response.statusText}.`,
        );
      }
      const declaredSize = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredSize) && declaredSize > maximumSourceBytes) {
        throw new Error(`Source ${source.id} exceeds the 5 MB collection limit.`);
      }
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > maximumSourceBytes) {
        throw new Error(`Source ${source.id} exceeds the 5 MB collection limit.`);
      }
      return new TextDecoder().decode(bytes);
    }
    throw new Error(`Source ${source.id} exceeded the redirect limit.`);
  }
}

const maximumSourceBytes = 5 * 1024 * 1024;

async function assertPublicSourceUrl(
  value: string,
  resolveAddresses: boolean,
): Promise<void> {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`Refusing non-public source URL ${value}.`);
  }
  const hostname = url.hostname.toLocaleLowerCase("en-US");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    (isIP(hostname) !== 0 && isPrivateAddress(hostname))
  ) {
    throw new Error(`Refusing private-network source URL ${value}.`);
  }
  if (resolveAddresses && isIP(hostname) === 0) {
    const addresses = await lookup(hostname, { all: true });
    if (
      addresses.length === 0 ||
      addresses.some((result) => isPrivateAddress(result.address))
    ) {
      throw new Error(`Refusing source ${value} because it resolves privately.`);
    }
  }
}

function isPrivateAddress(address: string): boolean {
  const normalized = address.toLocaleLowerCase("en-US");
  if (normalized.includes(":")) {
    return (
      normalized === "::1" ||
      normalized === "::" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      /^fe[89ab]/.test(normalized)
    );
  }
  const octets = normalized.split(".").map(Number);
  const first = octets[0] ?? -1;
  const second = octets[1] ?? -1;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first >= 224
  );
}

function parseJsonFeed(
  body: string,
  source: ConfiguredSource,
): CollectedMaterial[] {
  let document: unknown;
  try {
    document = JSON.parse(body);
  } catch {
    throw new Error(`Source ${source.id} returned malformed JSON.`);
  }
  const items = arrayOfRecords(asRecord(document)?.items);
  return items.flatMap((item) => {
    const title = textValue(item.title);
    const url = textValue(item.url) ?? textValue(item.external_url);
    if (title === null || url === null || !isPublicHttpUrl(url)) {
      return [];
    }
    const rawContent =
      textValue(item.content_text) ??
      textValue(item.content_html) ??
      textValue(item.summary) ??
      "";
    const content = htmlToText(rawContent);
    const authors = arrayOfRecords(item.authors);
    const author =
      textValue(authors[0]?.name) ?? textValue(asRecord(item.author)?.name);
    return [
      createCollectedMaterial({
        source,
        title,
        url,
        author,
        publishedAt: normalizedDate(textValue(item.date_published)),
        content,
        provenance: [source.url, url],
      }),
    ];
  });
}

function parseWebPage(
  html: string,
  source: ConfiguredSource,
): CollectedMaterial[] {
  const title =
    metaContent(html, "property", "og:title") ??
    captureTagText(html, "title");
  if (title === null) {
    return [];
  }
  const article = captureTagHtml(html, "article") ?? html;
  const content = htmlToText(article);
  return [
    createCollectedMaterial({
      source,
      title: htmlToText(title),
      url: source.url,
      author:
        metaContent(html, "name", "author") ??
        metaContent(html, "property", "article:author"),
      publishedAt: normalizedDate(
        metaContent(html, "property", "article:published_time"),
      ),
      content,
      provenance: [source.url],
    }),
  ];
}

function createCollectedMaterial(input: {
  source: ConfiguredSource;
  title: string;
  url: string;
  author: string | null;
  publishedAt: string | null;
  content: string;
  provenance: string[];
}): CollectedMaterial {
  return {
    id: randomUUID(),
    fingerprint: createHash("sha256").update(input.url).digest("hex"),
    title: input.title,
    url: input.url,
    author: input.author,
    publishedAt: input.publishedAt,
    format: "article",
    summary: input.content.slice(0, 500),
    content: input.content,
    estimatedMinutes: Math.max(1, Math.ceil(wordCount(input.content) / 220)),
    source: { id: input.source.id, name: input.source.name },
    provenance: input.provenance,
  };
}

function captureTagText(html: string, tag: string): string | null {
  return captureTagHtml(html, tag);
}

function captureTagHtml(html: string, tag: string): string | null {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i").exec(
    html,
  );
  return match?.[1]?.trim() ?? null;
}

function metaContent(
  html: string,
  attribute: "name" | "property",
  value: string,
): string | null {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const target = new RegExp(`${attribute}=["']${escapeRegExp(value)}["']`, "i");
    if (!target.test(tag)) {
      continue;
    }
    const content = /content=["']([^"']*)["']/i.exec(tag)?.[1]?.trim();
    if (content !== undefined && content.length > 0) {
      return htmlToText(content);
    }
  }
  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseXmlFeed(
  xml: string,
  source: ConfiguredSource,
): CollectedMaterial[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    processEntities: false,
    trimValues: true,
  });
  const document = parser.parse(xml) as Record<string, unknown>;
  const rssChannel = asRecord(asRecord(document.rss)?.channel);
  const rssItems = arrayOfRecords(rssChannel?.item);
  const atomFeed = asRecord(document.feed);
  const atomItems = arrayOfRecords(atomFeed?.entry);
  const items = rssItems.length > 0 ? rssItems : atomItems;

  return items.flatMap((item) => {
    const title = textValue(item.title);
    const url = feedItemUrl(item);
    if (title === null || url === null || !isPublicHttpUrl(url)) {
      return [];
    }
    const rawContent =
      textValue(item["content:encoded"]) ??
      textValue(item.content) ??
      textValue(item.description) ??
      textValue(item.summary) ??
      "";
    const content = htmlToText(rawContent);
    const author =
      textValue(item.author) ?? textValue(item["dc:creator"]) ?? null;
    const publishedAt = normalizedDate(
      textValue(item.pubDate) ??
        textValue(item.published) ??
        textValue(item.updated),
    );

    return [
      {
        id: randomUUID(),
        fingerprint: createHash("sha256").update(url).digest("hex"),
        title,
        url,
        author,
        publishedAt,
        format: "article" as const,
        summary: content.slice(0, 500),
        content,
        estimatedMinutes: Math.max(1, Math.ceil(wordCount(content) / 220)),
        source: { id: source.id, name: source.name },
        provenance: [source.url, url],
      },
    ];
  });
}

function feedItemUrl(item: Record<string, unknown>): string | null {
  const link = item.link;
  if (typeof link === "string") {
    return link.trim();
  }
  if (Array.isArray(link)) {
    const alternate = link
      .map(asRecord)
      .find((candidate) => candidate?.["@_rel"] !== "self");
    return textValue(alternate?.["@_href"]);
  }
  const linkRecord = asRecord(link);
  return textValue(linkRecord?.["@_href"]);
}

function textValue(value: unknown): string | null {
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value).trim();
    return text.length === 0 ? null : text;
  }
  const record = asRecord(value);
  return record === null ? null : textValue(record["#text"]);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function arrayOfRecords(value: unknown): Record<string, unknown>[] {
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return values.flatMap((candidate) => {
    const record = asRecord(candidate);
    return record === null ? [] : [record];
  });
}

function normalizedDate(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function htmlToText(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function wordCount(value: string): number {
  return value.length === 0 ? 0 : value.split(/\s+/u).length;
}

function isPublicHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

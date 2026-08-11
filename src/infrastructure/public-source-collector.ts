import { createHash } from "node:crypto";
import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from "node:dns";
import { isIP } from "node:net";

import { XMLParser } from "fast-xml-parser";
import ipaddr from "ipaddr.js";
import { Agent, ProxyAgent, fetch as undiciFetch } from "undici";

import type { ConfiguredSource } from "../config/configuration.js";
import type { CollectedMaterial, MaterialFormat, SourceProbeResult } from "../domain/contracts.js";

interface SourceContentCache {
  get(url: string, retentionDays?: number): Promise<string | null>;
  put(url: string, body: string, retentionDays?: number): Promise<void>;
  sweepExpired(): Promise<number>;
}

export type Fetcher = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export class PublicSourceCollector {
  readonly #fetch: Fetcher;
  readonly #cache: SourceContentCache | null;

  constructor(fetcher: Fetcher = safePublicFetch, cache: SourceContentCache | null = null) {
    this.#fetch = fetcher;
    this.#cache = cache;
  }

  async collect(sources: ConfiguredSource[]): Promise<CollectedMaterial[]> {
    await this.#cache?.sweepExpired();
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

  async probe(sources: ConfiguredSource[]): Promise<SourceProbeResult[]> {
    const results: SourceProbeResult[] = [];
    for (const source of sources.filter((s) => s.enabled)) {
      const start = performance.now();
      try {
        const body = await this.#fetchSource(source);
        let items: CollectedMaterial[];
        switch (source.kind) {
          case "rss":
          case "atom":
            items = parseXmlFeed(body, source);
            break;
          case "json-feed":
            items = parseJsonFeed(body, source);
            break;
          case "web":
            items = parseWebPage(body, source);
            break;
        }
        results.push({
          sourceId: source.id,
          sourceName: source.name,
          status: "ok",
          itemCount: items.length,
          durationMs: Math.round(performance.now() - start),
        });
      } catch (error) {
        results.push({
          sourceId: source.id,
          sourceName: source.name,
          status: "failed",
          itemCount: 0,
          durationMs: Math.round(performance.now() - start),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return results;
  }

  async broaden(materials: CollectedMaterial[]): Promise<CollectedMaterial[]> {
    const seen = new Set(materials.flatMap((material) => [material.url, ...material.provenance]));
    const references = materials.flatMap((material) =>
      material.referencedUrls.map((url) => ({ parent: material, url })),
    ).filter(({ url }) => !seen.has(url)).slice(0, maximumBroadenedSources);
    const discovered = await Promise.all(
      references.map(async ({ parent, url }, index) => {
        const source: ConfiguredSource = {
          id: `discovered-${index}`,
          name: `Discovered via ${parent.source.name}`,
          kind: "web",
          url,
          enabled: true,
          cache_retention_days: 0,
        };
        const body = await this.#fetchSource(source);
        return parseWebPage(body, source).map((material) => ({
          ...material,
          provenance: [...parent.provenance, parent.url, url],
        }));
      }),
    );
    return discovered.flat();
  }

  async #collectSource(source: ConfiguredSource): Promise<CollectedMaterial[]> {
    const cachingAllowed = source.cache_retention_days !== 0;
    const cached = cachingAllowed
      ? await this.#cache?.get(source.url, source.cache_retention_days)
      : null;
    const body = cached ?? (await this.#fetchSource(source));
    if (cached === null && this.#cache !== null) {
      await this.#cache.put(
        source.url,
        body,
        source.cache_retention_days,
      );
    }

    switch (source.kind) {
      case "rss":
      case "atom":
        return parseXmlFeed(body, source);
      case "json-feed":
        return parseJsonFeed(body, source);
      case "web":
        return parseWebPage(body, source);
    }
  }

  async #fetchSource(source: ConfiguredSource): Promise<string> {
    let currentUrl = source.url;
    for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
      assertPublicSourceUrl(currentUrl);
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
      return readBoundedBody(response, source.id);
    }
    throw new Error(`Source ${source.id} exceeded the redirect limit.`);
  }
}

const maximumSourceBytes = 5 * 1024 * 1024;
const maximumBroadenedSources = 8;

async function readBoundedBody(response: Response, sourceId: string): Promise<string> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > maximumSourceBytes) {
        await reader.cancel("Musement source size limit exceeded");
        throw new Error(`Source ${sourceId} exceeds the 5 MB collection limit.`);
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

function assertPublicSourceUrl(value: string): void {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`Refusing non-public source URL ${value}.`);
  }
  const hostname = url.hostname
    .replace(/^\[|\]$/g, "")
    .toLocaleLowerCase("en-US");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    (isIP(hostname) !== 0 && isPrivateAddress(hostname))
  ) {
    throw new Error(`Refusing private-network source URL ${value}.`);
  }
}

const safeDispatcher = new Agent({ connect: { lookup: safeLookup } });

export function safePublicFetch(
  input: string,
  init?: RequestInit,
): Promise<Response> {
  const request = { ...init, dispatcher: safeDispatcher };
  return undiciFetch(input, request as never) as unknown as Promise<Response>;
}

/**
 * Build the fetcher used for source collection. With a proxy URL, requests go
 * through that proxy — which does its own DNS and egress — so the direct-DNS
 * SSRF guard cannot run; the URL-literal guard in {@link assertPublicSourceUrl}
 * still refuses localhost and private-IP targets on every fetched URL. Without a
 * proxy, the direct safe-DNS fetcher is used unchanged.
 */
export function createSourceFetcher(proxyUrl?: string | null): Fetcher {
  if (proxyUrl === undefined || proxyUrl === null || proxyUrl === "") {
    return safePublicFetch;
  }
  const dispatcher = new ProxyAgent(proxyUrl);
  return (input, init) =>
    undiciFetch(input, { ...init, dispatcher } as never) as unknown as Promise<Response>;
}

/**
 * The proxy Musement should route source fetches through: an explicit
 * configuration value first, then the conventional proxy environment variables.
 */
export function resolveProxyUrl(
  configuredProxyUrl: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return (
    configuredProxyUrl ??
    env.HTTPS_PROXY ??
    env.https_proxy ??
    env.ALL_PROXY ??
    env.all_proxy ??
    null
  );
}

function safeLookup(
  hostname: string,
  options: LookupOptions,
  callback: (
    error: NodeJS.ErrnoException | null,
    address: string | LookupAddress[],
    family?: number,
  ) => void,
): void {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error !== null) {
      callback(error, []);
      return;
    }
    const publicAddresses = addresses.filter(
      (address) => !isPrivateAddress(address.address),
    );
    if (publicAddresses.length !== addresses.length || publicAddresses.length === 0) {
      const refusal = new Error(
        `Refusing source host ${hostname} because it resolves privately.`,
      ) as NodeJS.ErrnoException;
      refusal.code = "EPRIVATEHOST";
      callback(refusal, []);
      return;
    }
    if (options.all === true) {
      callback(null, publicAddresses);
      return;
    }
    const selected = publicAddresses[0];
    if (selected === undefined) {
      callback(new Error(`Source host ${hostname} has no addresses.`), []);
      return;
    }
    callback(null, selected.address, selected.family);
  });
}

function isPrivateAddress(address: string): boolean {
  try {
    return ipaddr.parse(address).range() !== "unicast";
  } catch {
    return true;
  }
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
        referencedUrls: linksFromHtml(rawContent, url),
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
      referencedUrls: linksFromHtml(article, source.url),
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
  referencedUrls: string[];
  format?: MaterialFormat;
  durationMinutes?: number | null;
}): CollectedMaterial {
  const fingerprint = createHash("sha256").update(input.url).digest("hex");
  return {
    id: fingerprint,
    fingerprint,
    title: input.title,
    url: input.url,
    author: input.author,
    publishedAt: input.publishedAt,
    format: input.format ?? "article",
    summary: input.content.slice(0, 500),
    content: input.content,
    estimatedMinutes:
      input.durationMinutes ??
      Math.max(1, Math.ceil(wordCount(input.content) / 220)),
    source: { id: input.source.id, name: input.source.name },
    provenance: input.provenance,
    referencedUrls: input.referencedUrls,
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
  // RSS 1.0 keeps its items beside the channel rather than inside it.
  const rdfItems = arrayOfRecords(asRecord(document["rdf:RDF"])?.item);
  const items =
    rssItems.length > 0
      ? rssItems
      : atomItems.length > 0
        ? atomItems
        : rdfItems;

  return items.flatMap((item) => {
    const title = textValue(item.title);
    const url = feedItemUrl(item);
    if (title === null || url === null || !isPublicHttpUrl(url)) {
      return [];
    }
    const mediaGroup = asRecord(item["media:group"]);
    const rawContent =
      textValue(item["content:encoded"]) ??
      textValue(item.content) ??
      textValue(item.description) ??
      textValue(item.summary) ??
      textValue(mediaGroup?.["media:description"]) ??
      "";
    const content = htmlToText(rawContent);
    const author =
      textValue(item.author) ??
      textValue(item["dc:creator"]) ??
      textValue(asRecord(item["media:credit"])?.["#text"]) ??
      null;
    const publishedAt = normalizedDate(
      textValue(item.pubDate) ??
        textValue(item.published) ??
        textValue(item.updated) ??
        textValue(item["dc:date"]) ??
        textValue(item["prism:publicationDate"]),
    );

    return [
      createCollectedMaterial({
        source,
        title,
        url,
        author,
        publishedAt,
        content,
        provenance: [source.url, url],
        referencedUrls: linksFromHtml(rawContent, url),
        format: feedItemFormat(item, mediaGroup),
        durationMinutes: declaredDurationMinutes(item),
      }),
    ];
  });
}

/**
 * Podcast and video Materials declare their real length; an Attention Budget
 * cannot be reasoned about from the word count of a show-note blurb.
 */
function declaredDurationMinutes(item: Record<string, unknown>): number | null {
  const declared = textValue(item["itunes:duration"]);
  if (declared === null) {
    return null;
  }
  const seconds = declared.includes(":")
    ? declared
        .split(":")
        .map(Number)
        .reduce(
          (total, part) =>
            total === null || !Number.isFinite(part) ? null : total * 60 + part,
          0 as number | null,
        )
    : Number(declared);
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  return Math.max(1, Math.round(seconds / 60));
}

function feedItemFormat(
  item: Record<string, unknown>,
  mediaGroup: Record<string, unknown> | null,
): MaterialFormat {
  if (item["yt:videoId"] !== undefined) {
    return "video";
  }
  const enclosureType =
    textValue(asRecord(item.enclosure)?.["@_type"]) ??
    textValue(asRecord(mediaGroup?.["media:content"])?.["@_type"]) ??
    "";
  if (enclosureType.startsWith("audio/")) {
    return "podcast";
  }
  if (enclosureType.startsWith("video/")) {
    return "video";
  }
  return mediaGroup === null ? "article" : "video";
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

function linksFromHtml(value: string, baseUrl: string): string[] {
  const links = new Set<string>();
  for (const match of value.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)) {
    try {
      const url = new URL(match[1] ?? "", baseUrl);
      if ((url.protocol === "https:" || url.protocol === "http:") && url.username === "" && url.password === "") {
        url.hash = "";
        links.add(url.href);
      }
    } catch {
      // Ignore malformed references; configured and fetched URLs remain traced.
    }
  }
  return [...links];
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

import type { MaterialCollector } from "../application/ai-edition-editor.js";
import type { ConfiguredSource } from "../config/configuration.js";
import type { CollectedMaterial } from "../domain/contracts.js";

import { safePublicFetch, type Fetcher } from "./public-source-collector.js";

/**
 * A transcript is a stable derived rendering of a video's own captions, not a
 * cached copy of fetched source content. It is persisted indefinitely, keyed by
 * video id, alongside the other derived metadata Musement already keeps. See
 * docs/adr/0018-persist-derived-video-transcripts.md.
 */
export interface StoredTranscript {
  videoId: string;
  fetchedAt: string;
  status: "available" | "unavailable";
  language: string | null;
  durationSeconds: number | null;
  transcript: string;
}

export interface TranscriptStore {
  findTranscript(videoId: string): StoredTranscript | null;
  saveTranscript(record: StoredTranscript): void;
}

/**
 * YouTube's Atom feed carries only a promo description, which cannot be judged
 * on its own and often falls below the coded substance floor. This connector
 * replaces a video's content with its own captions when they exist, and always
 * corrects its length from the real video duration. Captions never change once
 * published, so a resolved transcript is fetched once and reused forever; a
 * genuinely caption-less video records that fact but is re-checked periodically
 * because captions can appear later.
 */
export class YouTubeTranscriptConnector {
  readonly #store: TranscriptStore;
  readonly #fetch: Fetcher;
  readonly #now: () => Date;

  constructor(
    store: TranscriptStore,
    fetcher: Fetcher = safePublicFetch,
    now: () => Date = () => new Date(),
  ) {
    this.#store = store;
    this.#fetch = fetcher;
    this.#now = now;
  }

  async enrich(materials: CollectedMaterial[]): Promise<CollectedMaterial[]> {
    return mapWithConcurrency(materials, transcriptConcurrency, (material) =>
      this.#enrichOne(material),
    );
  }

  async #enrichOne(material: CollectedMaterial): Promise<CollectedMaterial> {
    if (material.format !== "video") {
      return material;
    }
    const videoId = videoIdFromUrl(material.url);
    if (videoId === null) {
      return material;
    }
    const record = await this.#resolve(videoId);
    if (record === null) {
      return material;
    }
    const estimatedMinutes =
      record.durationSeconds !== null && record.durationSeconds > 0
        ? Math.max(1, Math.round(record.durationSeconds / 60))
        : material.estimatedMinutes;
    if (record.status !== "available" || record.transcript.length === 0) {
      // No captions: keep the description as content, but trust the real length.
      return { ...material, estimatedMinutes };
    }
    return {
      ...material,
      content: record.transcript,
      summary: record.transcript.slice(0, 500),
      estimatedMinutes,
    };
  }

  async #resolve(videoId: string): Promise<StoredTranscript | null> {
    const cached = this.#store.findTranscript(videoId);
    if (cached !== null && !this.#shouldRefetch(cached)) {
      return cached;
    }
    let fetched: StoredTranscript;
    try {
      fetched = await this.#fetchTranscript(videoId);
    } catch {
      // A transient failure must not freeze a permanent "unavailable"; fall back
      // to any prior record and let a later run try again.
      return cached;
    }
    this.#store.saveTranscript(fetched);
    return fetched;
  }

  #shouldRefetch(cached: StoredTranscript): boolean {
    if (cached.status === "available") {
      return false;
    }
    const age = this.#now().getTime() - Date.parse(cached.fetchedAt);
    return !Number.isFinite(age) || age >= negativeRecheckMs;
  }

  async #fetchTranscript(videoId: string): Promise<StoredTranscript> {
    const player = await this.#fetch(
      `https://www.youtube.com/youtubei/v1/player?key=${innertubeApiKey}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": iosUserAgent,
        },
        body: JSON.stringify({
          videoId,
          context: {
            client: {
              clientName: "IOS",
              clientVersion: iosClientVersion,
              hl: "en",
            },
          },
        }),
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!player.ok) {
      throw new Error(`Player request for ${videoId} returned ${player.status}.`);
    }
    const details = playerDetails(await player.text());
    const fetchedAt = this.#now().toISOString();
    if (details.trackUrl === null) {
      return {
        videoId,
        fetchedAt,
        status: "unavailable",
        language: null,
        durationSeconds: details.durationSeconds,
        transcript: "",
      };
    }
    const track = await this.#fetch(details.trackUrl, {
      headers: { "user-agent": iosUserAgent },
      signal: AbortSignal.timeout(20_000),
    });
    if (!track.ok) {
      throw new Error(`Caption request for ${videoId} returned ${track.status}.`);
    }
    const transcript = plainTextFromTimedText(await track.text());
    return {
      videoId,
      fetchedAt,
      status: transcript.length === 0 ? "unavailable" : "available",
      language: details.language,
      durationSeconds: details.durationSeconds,
      transcript,
    };
  }
}

/**
 * A collector that resolves feed Materials normally, then replaces video promo
 * descriptions with real transcripts before eligibility is assessed.
 */
export class TranscriptEnrichingCollector implements MaterialCollector {
  readonly #base: MaterialCollector;
  readonly #connector: YouTubeTranscriptConnector;
  broaden?: (materials: CollectedMaterial[]) => Promise<CollectedMaterial[]>;

  constructor(base: MaterialCollector, connector: YouTubeTranscriptConnector) {
    this.#base = base;
    this.#connector = connector;
    const baseBroaden = base.broaden;
    if (baseBroaden !== undefined) {
      this.broaden = async (materials) =>
        this.#connector.enrich(await baseBroaden.call(base, materials));
    }
  }

  async collect(sources: ConfiguredSource[]): Promise<CollectedMaterial[]> {
    return this.#connector.enrich(await this.#base.collect(sources));
  }
}

// The long-lived public web client key used by YouTube's own player; the iOS
// client is the one that still returns caption tracks. This is an undocumented
// path with no official alternative (the Data API only serves captions for
// videos the caller owns), so every failure degrades to the feed description.
const innertubeApiKey = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const iosClientVersion = "20.10.4";
const iosUserAgent =
  "com.google.ios.youtube/20.10.4 (iPhone; U; CPU iOS 18_3 like Mac OS X)";
const transcriptConcurrency = 8;
const negativeRecheckMs = 14 * 24 * 60 * 60 * 1000;

interface PlayerDetails {
  trackUrl: string | null;
  language: string | null;
  durationSeconds: number | null;
}

function playerDetails(body: string): PlayerDetails {
  let document: unknown;
  try {
    document = JSON.parse(body);
  } catch {
    return { trackUrl: null, language: null, durationSeconds: null };
  }
  const root = asRecord(document);
  const lengthSeconds = Number(
    asRecord(root?.videoDetails)?.lengthSeconds ?? Number.NaN,
  );
  const durationSeconds = Number.isFinite(lengthSeconds) ? lengthSeconds : null;
  const tracks = asArray(
    asRecord(
      asRecord(root?.captions)?.playerCaptionsTracklistRenderer,
    )?.captionTracks,
  );
  const parsed = tracks
    .map(asRecord)
    .filter((track): track is Record<string, unknown> => track !== null)
    .map((track) => ({
      baseUrl: typeof track.baseUrl === "string" ? track.baseUrl : null,
      languageCode:
        typeof track.languageCode === "string" ? track.languageCode : null,
      isAuto: track.kind === "asr",
    }))
    .filter((track) => track.baseUrl !== null);
  // Prefer a human-authored track over machine transcription when both exist.
  const chosen = parsed.find((track) => !track.isAuto) ?? parsed[0] ?? null;
  return {
    trackUrl: chosen?.baseUrl ?? null,
    language: chosen?.languageCode ?? null,
    durationSeconds,
  };
}

export function videoIdFromUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const host = url.hostname.toLocaleLowerCase("en-US");
  const id =
    host === "youtu.be"
      ? url.pathname.slice(1)
      : host.endsWith("youtube.com")
        ? (url.searchParams.get("v") ??
          (url.pathname.startsWith("/shorts/")
            ? url.pathname.split("/")[2]
            : null))
        : null;
  return id !== null && id !== undefined && /^[\w-]{6,}$/.test(id) ? id : null;
}

function plainTextFromTimedText(xml: string): string {
  return decodeEntities(xml.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, () =>
    (async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(items[index]!);
      }
    })(),
  );
  await Promise.all(runners);
  return results;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

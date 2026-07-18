import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Clock } from "../domain/contracts.js";

export interface RawMaterialCacheOptions {
  directory: string;
  defaultRetentionDays: number;
  clock?: Clock;
}

interface CacheEntry {
  url: string;
  fetchedAt: string;
  expiresAt: string;
  body: string;
}

export class RawMaterialCache {
  readonly #directory: string;
  readonly #defaultRetentionDays: number;
  readonly #clock: Clock;

  constructor(options: RawMaterialCacheOptions) {
    this.#directory = options.directory;
    this.#defaultRetentionDays = options.defaultRetentionDays;
    this.#clock = options.clock ?? { now: () => new Date() };
  }

  async get(url: string, retentionDays?: number): Promise<string | null> {
    const path = this.#pathFor(url);
    let entry: CacheEntry;
    try {
      entry = JSON.parse(await readFile(path, "utf8")) as CacheEntry;
    } catch (error) {
      if (isMissingFile(error)) {
        return null;
      }
      throw new Error(`Raw Material Cache entry for ${url} is unreadable.`);
    }
    const configuredExpiry =
      retentionDays === undefined
        ? Number.POSITIVE_INFINITY
        : Date.parse(entry.fetchedAt) + retentionDays * 24 * 60 * 60 * 1_000;
    if (
      Math.min(Date.parse(entry.expiresAt), configuredExpiry) <=
      this.#clock.now().getTime()
    ) {
      await rm(path, { force: true });
      return null;
    }
    return entry.body;
  }

  async put(
    url: string,
    body: string,
    retentionDays = this.#defaultRetentionDays,
  ): Promise<void> {
    if (retentionDays === 0) {
      await rm(this.#pathFor(url), { force: true });
      return;
    }
    await mkdir(this.#directory, { recursive: true });
    const now = this.#clock.now();
    const entry: CacheEntry = {
      url,
      fetchedAt: now.toISOString(),
      expiresAt: new Date(
        now.getTime() + retentionDays * 24 * 60 * 60 * 1_000,
      ).toISOString(),
      body,
    };
    const destination = this.#pathFor(url);
    const temporary = join(this.#directory, `.${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(entry), {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, destination);
  }

  async sweepExpired(): Promise<number> {
    let names: string[];
    try {
      names = await readdir(this.#directory);
    } catch (error) {
      if (isMissingFile(error)) return 0;
      throw error;
    }
    let removed = 0;
    for (const name of names.filter((candidate) => candidate.endsWith(".json"))) {
      const path = join(this.#directory, name);
      try {
        const entry = JSON.parse(await readFile(path, "utf8")) as CacheEntry;
        if (Date.parse(entry.expiresAt) > this.#clock.now().getTime()) continue;
      } catch {
        // An unreadable cache artifact cannot be trusted as retained source data.
      }
      await rm(path, { force: true });
      removed += 1;
    }
    return removed;
  }

  #pathFor(url: string): string {
    return join(
      this.#directory,
      `${createHash("sha256").update(url).digest("hex")}.json`,
    );
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

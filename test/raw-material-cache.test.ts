import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { RawMaterialCache } from "../src/infrastructure/raw-material-cache.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("Raw Material Cache", () => {
  it("expires source content and honors a source-level no-cache rule", async () => {
    const directory = await mkdtemp(join(tmpdir(), "musement-cache-"));
    temporaryDirectories.push(directory);
    const clock = new MutableClock(new Date("2026-07-18T00:00:00.000Z"));
    const cache = new RawMaterialCache({
      directory,
      defaultRetentionDays: 7,
      clock,
    });

    await cache.put("https://example.com/feed", "raw source content");
    await cache.put("https://example.com/no-cache", "must not persist", 0);

    expect(await cache.get("https://example.com/feed")).toBe(
      "raw source content",
    );
    expect(await cache.get("https://example.com/no-cache")).toBeNull();

    clock.current = new Date("2026-07-26T00:00:00.000Z");
    expect(await cache.get("https://example.com/feed")).toBeNull();
  });
});

class MutableClock {
  constructor(public current: Date) {}
  now(): Date {
    return this.current;
  }
}

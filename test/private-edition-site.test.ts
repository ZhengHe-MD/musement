import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { PrivateEditionSite } from "../src/application/private-edition-site.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("private Daily Edition site", () => {
  it("serves only the latest published edition at /today", async () => {
    const directory = await mkdtemp(join(tmpdir(), "musement-private-site-"));
    temporaryDirectories.push(directory);
    const site = new PrivateEditionSite({
      dataDirectory: directory,
      now: () => new Date("2026-07-20T12:00:00Z"),
    });
    await site.publish({
      localDate: "2026-07-20",
      timeZone: "Asia/Shanghai",
      html: "<!doctype html><title>First edition</title>",
    });
    await site.publish({
      localDate: "2026-07-20",
      timeZone: "Asia/Shanghai",
      html: "<!doctype html><title>Latest edition</title>",
    });
    const listener = await site.listen({ port: 0 });

    try {
      const today = await fetch(`${listener.origin}/today`);
      expect(today.status).toBe(200);
      expect(today.headers.get("content-type")).toBe(
        "text/html; charset=utf-8",
      );
      expect(today.headers.get("cache-control")).toBe("no-store");
      expect(today.headers.get("x-musement-private-site")).toBe(
        "current-edition-v1",
      );
      expect(await today.text()).toContain("Latest edition");

      const historical = await fetch(`${listener.origin}/2026-07-20`);
      expect(historical.status).toBe(404);
    } finally {
      await listener.close();
    }
  });

  it("stops serving an edition after its configured local date ends", async () => {
    const directory = await mkdtemp(join(tmpdir(), "musement-stale-site-"));
    temporaryDirectories.push(directory);
    const site = new PrivateEditionSite({
      dataDirectory: directory,
      now: () => new Date("2026-07-20T16:01:00Z"),
    });
    await site.publish({
      localDate: "2026-07-20",
      timeZone: "Asia/Shanghai",
      html: "<!doctype html><title>Yesterday</title>",
    });
    const listener = await site.listen({ port: 0 });

    try {
      const response = await fetch(`${listener.origin}/today`);
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain("Yesterday");
    } finally {
      await listener.close();
    }
  });
});

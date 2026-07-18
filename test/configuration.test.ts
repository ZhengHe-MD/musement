import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { loadConfiguration } from "../src/config/configuration.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("human-owned configuration", () => {
  it("loads an inspectable Interest Profile, Source Portfolio, and Attention Budget", async () => {
    const directory = await mkdtemp(join(tmpdir(), "musement-config-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "musement.yaml");
    await writeFile(
      path,
      `version: 1
timezone: Asia/Shanghai
attention_budget_minutes: 25
cache_retention_days: 7
interest_profile:
  enduring:
    - label: Physics
      description: Conceptual explanations that reshape how I understand reality.
      examples: [historical context]
  current: []
  soft_suppressions: [routine product announcements]
sources:
  - id: example-feed
    name: Example Feed
    kind: rss
    url: https://example.com/feed.xml
`,
      "utf8",
    );

    const configuration = await loadConfiguration(path);

    expect(configuration.attention_budget_minutes).toBe(25);
    expect(configuration.interest_profile.enduring[0]?.label).toBe("Physics");
    expect(configuration.sources[0]).toMatchObject({
      id: "example-feed",
      kind: "rss",
      enabled: true,
    });
  });

  it("rejects configuration without a usable public source", async () => {
    const directory = await mkdtemp(join(tmpdir(), "musement-config-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "musement.yaml");
    await writeFile(
      path,
      `version: 1
timezone: Asia/Shanghai
attention_budget_minutes: 25
interest_profile:
  enduring: []
  current: []
  soft_suppressions: []
sources: []
`,
      "utf8",
    );

    await expect(loadConfiguration(path)).rejects.toThrow(
      "At least one public source is required",
    );
  });
});

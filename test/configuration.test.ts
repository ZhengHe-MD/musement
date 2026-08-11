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
    expect(configuration.provider_timeout_seconds).toBe(300);
    expect(configuration.interest_profile.enduring[0]?.label).toBe("Physics");
    expect(configuration.sources[0]).toMatchObject({
      id: "example-feed",
      kind: "rss",
      enabled: true,
    });
  });

  it("accepts an optional proxy URL for source fetching", async () => {
    const directory = await mkdtemp(join(tmpdir(), "musement-config-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "musement.yaml");
    await writeFile(
      path,
      `version: 1
timezone: Asia/Shanghai
attention_budget_minutes: 25
network:
  proxy_url: http://127.0.0.1:7893
interest_profile:
  enduring: []
  current: []
  soft_suppressions: []
sources:
  - id: example-feed
    name: Example Feed
    kind: rss
    url: https://example.com/feed.xml
`,
      "utf8",
    );

    const configuration = await loadConfiguration(path);

    expect(configuration.network?.proxy_url).toBe("http://127.0.0.1:7893");
  });

  it("rejects a non-HTTP proxy URL", async () => {
    const directory = await mkdtemp(join(tmpdir(), "musement-config-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "musement.yaml");
    await writeFile(
      path,
      `version: 1
timezone: Asia/Shanghai
attention_budget_minutes: 25
network:
  proxy_url: socks5://127.0.0.1:7891
interest_profile:
  enduring: []
  current: []
  soft_suppressions: []
sources:
  - id: example-feed
    name: Example Feed
    kind: rss
    url: https://example.com/feed.xml
`,
      "utf8",
    );

    await expect(loadConfiguration(path)).rejects.toThrow(
      "must be an HTTP or HTTPS proxy URL",
    );
  });

  it("rejects credentials embedded in source URLs", async () => {
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
sources:
  - id: credentialed
    name: Credentialed
    kind: rss
    url: https://user:secret@example.com/feed.xml
`,
    );

    await expect(loadConfiguration(path)).rejects.toThrow(
      "must not contain credentials",
    );
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

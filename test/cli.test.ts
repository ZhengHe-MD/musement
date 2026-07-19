import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { Musement } from "../src/application/musement.js";
import { runCli, type Runtime } from "../src/cli.js";
import { loadConfiguration } from "../src/config/configuration.js";
import type { DailyEditionDraft, EditionEditor } from "../src/domain/contracts.js";
import { SqliteMusementStore } from "../src/infrastructure/sqlite-musement-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("Musement CLI", () => {
  it("initializes an editable first-user configuration", async () => {
    const directory = await mkdtemp(join(tmpdir(), "musement-init-"));
    temporaryDirectories.push(directory);
    const configPath = join(directory, "musement.yaml");

    await runCli(
      ["node", "musement", "--config", configPath, "init"],
      {
        stdout: () => undefined,
        stderr: () => undefined,
        createRuntime: async () => {
          throw new Error("init must not start the runtime");
        },
      },
    );

    const configuration = await loadConfiguration(configPath);
    expect(configuration.timezone).toBe("Asia/Shanghai");
    expect(configuration.sources).toHaveLength(1);
  });

  it("shows the compact Daily Edition and emits stable JSON on demand", async () => {
    const directory = await mkdtemp(join(tmpdir(), "musement-cli-"));
    temporaryDirectories.push(directory);
    const textOutput: string[] = [];
    const runtime = createFixtureRuntime(directory);

    await runCli(["node", "musement", "today"], {
      stdout: (text) => textOutput.push(text),
      stderr: () => undefined,
      createRuntime: async () => runtime,
    });

    expect(textOutput.join("")).toContain("IMPORTANT");
    expect(textOutput.join("")).toContain("One worthwhile Discovery");
    expect(textOutput.join("")).toContain("https://example.com/one");
    expect(textOutput.join("")).toContain("PERSONALLY INTERESTING — unavailable");

    const jsonOutput: string[] = [];
    await runCli(["node", "musement", "today", "--json"], {
      stdout: (text) => jsonOutput.push(text),
      stderr: () => undefined,
      createRuntime: async () => createFixtureRuntime(directory),
    });
    expect(JSON.parse(jsonOutput.join(""))).toMatchObject({
      localDate: "2026-07-18",
      status: "degraded",
    });

  });

  it("emits a standalone, safe, bilingual Edition Review on demand", async () => {
    const directory = await mkdtemp(join(tmpdir(), "musement-html-"));
    temporaryDirectories.push(directory);
    const output: string[] = [];

    await runCli(["node", "musement", "today", "--html"], {
      stdout: (text) => output.push(text),
      stderr: () => undefined,
      createRuntime: async () => createFixtureRuntime(directory),
    });

    const html = output.join("");
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain(
      "<title>Musement Edition Review — 2026-07-18</title>",
    );
    expect(html).toContain("Today’s three encounters");
    expect(html).toContain("今日三则邂逅");
    expect(html).toContain("Why this edition");
    expect(html).toContain("为何是这一份");
    expect(html).toContain("Selected one inspectable candidate.");
    expect(html).toContain('<span lang="en">Selected</span>');
    expect(html).toContain('<span lang="zh-Hans">入选</span>');
    expect(html).toContain("1 candidate");
    expect(html).toContain("Raw trace");
    expect(html).toContain("Candidate provenance");
    expect(html).toContain("https://example.com/provenance");
    expect(html).toContain("pre { max-height: none; overflow: visible; }");
    expect(html).toContain('href="https://example.com/one"');
    expect(html).toContain("Personally Interesting");
    expect(html).toContain("No candidate met the quality floor.");
    expect(html).toContain('id="personally-interesting-unavailable-title"');
    expect(html).toContain('href="#assessment-one"');
    expect(html).toContain('id="assessment-one"');
    expect(html).toContain("Unavailable");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(html).toContain("Unsafe alternative (link unavailable)");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("fonts.googleapis.com");
  });

  it("emits a standalone, safe HTML Selection Trace on demand", async () => {
    const directory = await mkdtemp(join(tmpdir(), "musement-trace-html-"));
    temporaryDirectories.push(directory);

    const todayOutput: string[] = [];
    await runCli(["node", "musement", "today", "--html"], {
      stdout: (text) => todayOutput.push(text),
      stderr: () => undefined,
      createRuntime: async () => createFixtureRuntime(directory),
    });

    const output: string[] = [];
    await runCli(
      ["node", "musement", "trace", "2026-07-18", "--html"],
      {
        stdout: (text) => output.push(text),
        stderr: () => undefined,
        createRuntime: async () => createFixtureRuntime(directory),
      },
    );

    const html = output.join("");
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain(
      "<title>Musement Edition Review — 2026-07-18</title>",
    );
    expect(html).toBe(todayOutput.join(""));
    expect(html).toContain("One worthwhile Discovery");
    expect(html).toContain("No candidate met the quality floor.");
    expect(html).toContain("fixture-v1");
    expect(html).toContain("1 candidate");
    expect(html).toContain("Selected one inspectable candidate.");
    expect(html).toContain('href="https://example.com/one"');
    expect(html).toContain(
      "Candidate &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    );
    expect(html).toContain("eligible:coded-quality-floor");
    expect(html).toContain("Material ID");
    expect(html).toContain("<code>material-one</code>");
    expect(html).toContain("Discovery key");
    expect(html).toContain("<code>one</code>");
    expect(html).toContain("Topic key");
    expect(html).toContain("<code>fixture-topic</code>");
    expect(html).toContain("Personally Interesting");
    expect(html).toContain("Raw trace");
    expect(html).not.toContain("<script>");
  });

  it("reports whether the provider is safe for subscription-backed use", async () => {
    const output: string[] = [];
    const directory = await mkdtemp(join(tmpdir(), "musement-doctor-"));
    temporaryDirectories.push(directory);
    const runtime = createFixtureRuntime(directory);
    runtime.providerDiagnostics = async () => ({
      provider: "openai",
      authenticationMode: "chatgpt",
      planType: "plus",
      safeForMusement: true,
      rateLimits: { reachedType: null, usedPercent: null, resetsAt: null },
    });

    await runCli(["node", "musement", "doctor"], {
      stdout: (text) => output.push(text),
      stderr: () => undefined,
      createRuntime: async () => runtime,
    });

    expect(JSON.parse(output.join(""))).toMatchObject({
      authenticationMode: "chatgpt",
      safeForMusement: true,
    });
  });
});

function createFixtureRuntime(directory: string): Runtime {
  const store = new SqliteMusementStore(join(directory, "musement.sqlite"));
  return {
    musement: new Musement({
      store,
      editor: new FixtureEditor(),
      clock: { now: () => new Date("2026-07-18T08:00:00+08:00") },
      timezone: "Asia/Shanghai",
    }),
    close: () => store.close(),
  };
}

class FixtureEditor implements EditionEditor {
  async generate(request: { localDate: string }): Promise<DailyEditionDraft> {
    return {
      localDate: request.localDate,
      slots: [
        {
          role: "important",
          status: "filled",
          discovery: {
            id: "discovery-one-hash",
            subjectKey: "one",
            subjectTerms: ["worthwhile", "discovery"],
            title: 'One worthwhile Discovery <script>alert("x")</script>',
            summary: "A compact explanation of what it is.",
            slotReason: "It has meaningful consequences.",
            evidenceStatus: "Supported.",
            recommendedMaterial: {
              id: "material-one",
              fingerprint: "material-one".padEnd(64, "0"),
              title: "Read one",
              author: "Author",
              source: "Source",
              format: "article",
              url: "https://example.com/one",
              meaningfulEntryMinutes: 5,
              fullLengthMinutes: 12,
              provenance: ["https://example.com/original"],
            },
            alternativeMaterials: [
              {
                id: "unsafe-alternative",
                fingerprint: "unsafe-alternative".padEnd(64, "0"),
                title: "Unsafe alternative",
                author: "Unknown",
                source: "Untrusted",
                format: "article",
                url: "javascript:alert('x')",
                provenance: ["Untrusted fixture"],
              },
            ],
          },
        },
        {
          role: "personally-interesting",
          status: "unavailable",
          reason: "No candidate met the quality floor.",
        },
        {
          role: "wildcard",
          status: "unavailable",
          reason: "No candidate met the quality floor.",
        },
      ],
      trace: {
        candidates: [
          {
            materialId: "material-one",
            fingerprint: "material-one-fingerprint",
            title: 'Candidate <script>alert("x")</script>',
            url: "https://example.com/one",
            source: { id: "fixture", name: "Fixture Source" },
            provenance: ["https://example.com/provenance"],
            eligible: true,
            ruleOutcomes: ["eligible:coded-quality-floor"],
          },
        ],
        assessments: [
          {
            discovery_key: "one",
            topic_key: "fixture-topic",
            title: "One worthwhile Discovery",
            material_ids: ["material-one"],
            evidence_status: "Supported.",
            uncertainty: null,
            role_assessments: [
              {
                role: "personally-interesting",
                eligible: true,
                rationale: "Matches the declared curiosity profile.",
              },
            ],
          },
        ],
        shortlists: [
          {
            role: "personally-interesting",
            discovery_keys: ["one"],
          },
        ],
        decisions: ["Selected one inspectable candidate."],
        provider: {
          name: "fixture",
          model: "fixture-v1",
          promptVersion: "fixture-v1",
          schemaVersion: "1",
        },
      },
    };
  }
}

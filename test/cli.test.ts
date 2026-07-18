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
      rateLimits: { rateLimits: { rateLimitReachedType: null } },
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
            id: "one",
            title: "One worthwhile Discovery",
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
            alternativeMaterials: [],
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
        candidates: [],
        decisions: [],
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

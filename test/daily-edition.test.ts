import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { Musement } from "../src/application/musement.js";
import type {
  DailyEditionDraft,
  EditionEditor,
  GenerateEditionRequest,
} from "../src/domain/contracts.js";
import { SqliteMusementStore } from "../src/infrastructure/sqlite-musement-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("Daily Edition lifecycle", () => {
  it("generates today's edition once and returns the frozen edition thereafter", async () => {
    const directory = await mkdtemp(join(tmpdir(), "musement-edition-"));
    temporaryDirectories.push(directory);
    const store = new SqliteMusementStore(join(directory, "musement.sqlite"));
    const editor = new CountingFixtureEditor();
    const musement = new Musement({
      store,
      editor,
      clock: { now: () => new Date("2026-07-18T08:00:00+08:00") },
      timezone: "Asia/Shanghai",
    });

    const firstView = await musement.viewToday();
    const secondView = await musement.viewToday();

    expect(editor.calls).toBe(1);
    expect(secondView).toEqual(firstView);
    expect(firstView.localDate).toBe("2026-07-18");
    expect(firstView.status).toBe("complete");
    expect(firstView.slots.map((slot) => slot.role)).toEqual([
      "important",
      "personally-interesting",
      "wildcard",
    ]);

    store.close();
  });

  it("records a failed Generation Attempt and retries instead of freezing an edition", async () => {
    const directory = await mkdtemp(join(tmpdir(), "musement-attempt-"));
    temporaryDirectories.push(directory);
    const store = new SqliteMusementStore(join(directory, "musement.sqlite"));
    const editor = new FailsOnceEditor();
    const musement = new Musement({
      store,
      editor,
      clock: { now: () => new Date("2026-07-18T08:00:00+08:00") },
      timezone: "Asia/Shanghai",
    });

    await expect(musement.viewToday()).rejects.toThrow("Codex is unavailable");

    expect(musement.generationAttempts("2026-07-18")).toMatchObject([
      {
        localDate: "2026-07-18",
        status: "failed",
        failureReason: "Codex is unavailable",
      },
    ]);

    const edition = await musement.viewToday();

    expect(edition.localDate).toBe("2026-07-18");
    expect(editor.calls).toBe(2);
    expect(musement.generationAttempts("2026-07-18")).toHaveLength(2);
    expect(musement.generationAttempts("2026-07-18")[1]).toMatchObject({
      status: "succeeded",
      failureReason: null,
    });

    store.close();
  });

  it("rejects a Discovery that was exposed in an earlier Daily Edition", async () => {
    const directory = await mkdtemp(join(tmpdir(), "musement-exposure-"));
    temporaryDirectories.push(directory);
    const store = new SqliteMusementStore(join(directory, "musement.sqlite"));
    const editor = new CountingFixtureEditor();
    const clock = new MutableClock(new Date("2026-07-18T08:00:00+08:00"));
    const musement = new Musement({
      store,
      editor,
      clock,
      timezone: "Asia/Shanghai",
    });

    await musement.viewToday();
    clock.current = new Date("2026-07-19T08:00:00+08:00");

    await expect(musement.viewToday()).rejects.toThrow(
      "Discovery discovery-important was previously exposed",
    );
    expect(editor.requests[1]?.excludedDiscoveryIds).toContain(
      "discovery-important",
    );

    store.close();
  });
});

class CountingFixtureEditor implements EditionEditor {
  calls = 0;
  requests: GenerateEditionRequest[] = [];

  async generate(request: GenerateEditionRequest): Promise<DailyEditionDraft> {
    this.calls += 1;
    this.requests.push(request);
    return {
      localDate: request.localDate,
      slots: [
        filledSlot("important", "discovery-important", "A consequential change"),
        filledSlot(
          "personally-interesting",
          "discovery-interesting",
          "An idea matched to your curiosity",
        ),
        filledSlot("wildcard", "discovery-wildcard", "A rewarding surprise"),
      ],
      trace: {
        candidates: [],
        decisions: ["Fixture editor selected three distinct Discoveries."],
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

class MutableClock {
  constructor(public current: Date) {}

  now(): Date {
    return this.current;
  }
}

class FailsOnceEditor extends CountingFixtureEditor {
  override async generate(
    request: GenerateEditionRequest,
  ): Promise<DailyEditionDraft> {
    if (this.calls === 0) {
      this.calls += 1;
      throw new Error("Codex is unavailable");
    }
    return super.generate(request);
  }
}

function filledSlot(
  role: "important" | "personally-interesting" | "wildcard",
  discoveryId: string,
  title: string,
) {
  return {
    role,
    status: "filled" as const,
    discovery: {
      id: discoveryId,
      title,
      summary: `${title} explained in one sentence.`,
      slotReason: `This is the ${role} selection.`,
      evidenceStatus: "Supported by the recommended material.",
      recommendedMaterial: {
        id: `material-${discoveryId}`,
        fingerprint: `material-${discoveryId}`.padEnd(64, "0"),
        title: `${title}: the material`,
        author: "Example Author",
        source: "Example Source",
        format: "article" as const,
        url: `https://example.com/${discoveryId}`,
        meaningfulEntryMinutes: 8,
        fullLengthMinutes: 20,
        provenance: ["https://example.com/source"],
      },
      alternativeMaterials: [],
    },
  };
}

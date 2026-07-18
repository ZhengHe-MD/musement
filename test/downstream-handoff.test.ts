import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { Musement } from "../src/application/musement.js";
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

describe("Downstream Handoff", () => {
  it("publishes a consumer-neutral event only after explicit selection", async () => {
    const directory = await mkdtemp(join(tmpdir(), "musement-handoff-"));
    temporaryDirectories.push(directory);
    const store = new SqliteMusementStore(join(directory, "musement.sqlite"));
    const musement = new Musement({
      store,
      editor: new OneDiscoveryEditor(),
      clock: { now: () => new Date("2026-07-18T08:00:00+08:00") },
      timezone: "Asia/Shanghai",
    });

    await musement.viewToday();
    expect(musement.readHandoffEvents({ afterPosition: 0 })).toEqual([]);

    const event = musement.selectDiscovery({
      localDate: "2026-07-18",
      role: "important",
    });

    expect(event).toMatchObject({
      event_type: "DiscoverySelected",
      event_version: 1,
      position: 1,
      occurred_at: "2026-07-18T00:00:00.000Z",
      data: {
        edition: { local_date: "2026-07-18" },
        selection_slot: "important",
        discovery: {
          id: "discovery-one",
          title: "One worthwhile Discovery",
        },
        recommended_material: {
          url: "https://example.com/one",
        },
      },
    });
    expect(event).not.toHaveProperty("destination");
    expect(event).not.toHaveProperty("workflow");
    expect(musement.readHandoffEvents({ afterPosition: 0 })).toEqual([event]);

    store.close();
  });
});

class OneDiscoveryEditor implements EditionEditor {
  async generate(request: { localDate: string }): Promise<DailyEditionDraft> {
    return {
      localDate: request.localDate,
      slots: [
        {
          role: "important",
          status: "filled",
          discovery: {
            id: "discovery-one",
            subjectTerms: ["worthwhile", "discovery"],
            title: "One worthwhile Discovery",
            summary: "A compact explanation.",
            slotReason: "It has demonstrated consequences.",
            evidenceStatus: "Supported.",
            recommendedMaterial: {
              id: "material-one",
              fingerprint: "material-one".padEnd(64, "0"),
              title: "Read about one",
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

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { Musement } from "../src/application/musement.js";
import type {
  DailyEditionDraft,
  EditionEditor,
  PreferenceOperation,
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

describe("feedback and Preference Proposals", () => {
  it("keeps inferred Soft Suppression pending until explicit confirmation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "musement-feedback-"));
    temporaryDirectories.push(directory);
    const store = new SqliteMusementStore(join(directory, "musement.sqlite"));
    const applied: PreferenceOperation[] = [];
    const musement = new Musement({
      store,
      editor: new FeedbackFixtureEditor(),
      clock: { now: () => new Date("2026-07-18T08:00:00+08:00") },
      timezone: "Asia/Shanghai",
      interestProfile: {
        apply: async (operation) => {
          applied.push(operation);
        },
      },
    });
    await musement.viewToday();

    const result = musement.recordFeedback({
      localDate: "2026-07-18",
      role: "important",
      kind: "not-useful",
      reason: "topic",
    });

    expect(result.proposal).toMatchObject({
      status: "pending",
      operation: {
        type: "add-soft-suppression",
        value: "A topic that was not useful",
      },
    });
    expect(applied).toEqual([]);

    await musement.confirmPreferenceProposal(result.proposal!.id);

    expect(applied).toEqual([
      {
        type: "add-soft-suppression",
        value: "A topic that was not useful",
      },
    ]);
    expect(musement.preferenceProposals("confirmed")).toHaveLength(1);

    store.close();
  });
});

class FeedbackFixtureEditor implements EditionEditor {
  async generate(request: { localDate: string }): Promise<DailyEditionDraft> {
    return {
      localDate: request.localDate,
      slots: [
        {
          role: "important",
          status: "filled",
          discovery: {
            id: "feedback-discovery",
            subjectTerms: ["feedback", "topic"],
            title: "A topic that was not useful",
            summary: "A summary.",
            slotReason: "It seemed important.",
            evidenceStatus: "Supported.",
            recommendedMaterial: {
              id: "feedback-material",
              fingerprint: "feedback-material".padEnd(64, "0"),
              title: "Material",
              author: "Author",
              source: "Source",
              format: "article",
              url: "https://example.com/feedback",
              meaningfulEntryMinutes: 5,
              fullLengthMinutes: 10,
              provenance: ["https://example.com/feedback"],
            },
            alternativeMaterials: [],
          },
        },
        {
          role: "personally-interesting",
          status: "unavailable",
          reason: "No qualifying candidate.",
        },
        {
          role: "wildcard",
          status: "unavailable",
          reason: "No qualifying candidate.",
        },
      ],
      trace: {
        candidates: [],
        decisions: [],
        provider: {
          name: "fixture",
          model: "fixture",
          promptVersion: "fixture",
          schemaVersion: "1",
        },
      },
    };
  }
}

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

describe("one-time MVP evaluation", () => {
  it("uses the owner's retrospective judgment after one month and 20 editions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "musement-evaluation-"));
    temporaryDirectories.push(directory);
    const store = new SqliteMusementStore(join(directory, "musement.sqlite"));
    const clock = new MutableClock(new Date("2026-07-01T08:00:00+08:00"));
    const musement = new Musement({
      store,
      editor: new DateBasedEditor(),
      clock,
      timezone: "Asia/Shanghai",
    });

    for (let day = 1; day <= 20; day += 1) {
      clock.current = new Date(`2026-07-${String(day).padStart(2, "0")}T08:00:00+08:00`);
      await musement.viewToday();
    }
    clock.current = new Date("2026-08-01T08:00:00+08:00");

    const review = musement.mvpEvaluationReview();
    expect(review).toMatchObject({ ready: true, generatedEditions: 20 });
    expect(review.discoveries).toHaveLength(60);

    const evaluation = musement.recordMvpEvaluation({
      worthwhileDiscoveryIds: review.discoveries.slice(0, 5).map((item) => item.id),
      wantsToContinue: true,
    });

    expect(evaluation).toMatchObject({
      worthwhileDiscoveries: 5,
      wantsToContinue: true,
      succeeded: true,
    });
    expect(() =>
      musement.recordMvpEvaluation({
        worthwhileDiscoveryIds: [],
        wantsToContinue: false,
      }),
    ).toThrow("already been recorded");

    store.close();
  });
});

class MutableClock {
  constructor(public current: Date) {}
  now(): Date {
    return this.current;
  }
}

class DateBasedEditor implements EditionEditor {
  async generate(request: { localDate: string }): Promise<DailyEditionDraft> {
    return {
      localDate: request.localDate,
      slots: (["important", "personally-interesting", "wildcard"] as const).map(
        (role) => ({
          role,
          status: "filled" as const,
          discovery: {
            id: `${request.localDate}-${role}`,
            subjectKey: `${request.localDate}-${role}`,
            subjectTerms: [`${request.localDate}-${role}`],
            title: `${request.localDate} ${role}`,
            summary: "A worthwhile Discovery.",
            slotReason: `It distinctly fits ${role}.`,
            evidenceStatus: "Supported.",
            recommendedMaterial: {
              id: `material-${request.localDate}-${role}`,
              fingerprint: `material-${request.localDate}-${role}`.padEnd(64, "0"),
              title: "Recommended Material",
              author: "Author",
              source: "Source",
              format: "article" as const,
              url: `https://example.com/${request.localDate}/${role}`,
              meaningfulEntryMinutes: 5,
              fullLengthMinutes: 10,
              provenance: ["https://example.com"],
            },
            alternativeMaterials: [],
          },
        }),
      ),
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

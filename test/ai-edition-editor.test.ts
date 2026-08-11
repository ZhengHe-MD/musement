import { describe, expect, it } from "vitest";

import { AiEditionEditor } from "../src/application/ai-edition-editor.js";
import type { MusementConfiguration } from "../src/config/configuration.js";
import type { CollectedMaterial } from "../src/domain/contracts.js";
import type {
  StructuredCompletion,
  StructuredCompletionRequest,
} from "../src/infrastructure/codex-app-server-provider.js";

describe("AI-assisted editorial selection", () => {
  it("applies coded quality rules and assembles three validated Selection Slots", async () => {
    const materials = [
      material("material-important", "Consequential policy change"),
      material("material-important-analysis", "Analysis of the policy change"),
      material("material-interesting", "A new view of animal cognition"),
      material("material-wildcard", "How ancient pigments were manufactured"),
      { ...material("material-shallow", "Tiny note"), content: "Too short." },
    ];
    const provider = new FixtureStructuredProvider({
      slots: [
        selection(
          "important",
          "policy-change",
          "public-policy",
          "material-important",
          ["material-important-analysis"],
        ),
        selection(
          "personally-interesting",
          "animal-cognition",
          "cognitive-science",
          "material-interesting",
        ),
        selection(
          "wildcard",
          "ancient-pigments",
          "material-culture",
          "material-wildcard",
        ),
      ],
      candidate_assessments: [
        assessment("policy-change", "public-policy", ["material-important", "material-important-analysis"]),
        assessment("animal-cognition", "cognitive-science", ["material-interesting"]),
        assessment("ancient-pigments", "material-culture", ["material-wildcard"]),
      ],
      shortlists: [
        { role: "important", discovery_keys: ["policy-change"] },
        { role: "personally-interesting", discovery_keys: ["animal-cognition"] },
        { role: "wildcard", discovery_keys: ["ancient-pigments"] },
      ],
      decisions: ["Selected distinct topics with adequate evidence."],
    });
    const editor = new AiEditionEditor({
      configuration,
      collector: { collect: async () => materials },
      provider,
    });

    const draft = await editor.generate({
      localDate: "2026-07-18",
      excludedDiscoveryIds: [],
      priorExposures: [],
      priorEnlistments: [],
      feedbackEvidence: [],
    });

    expect(draft.slots.map((slot) => [slot.role, slot.status])).toEqual([
      ["important", "filled"],
      ["personally-interesting", "filled"],
      ["wildcard", "filled"],
    ]);
    expect(draft.slots[0]).toMatchObject({
      status: "filled",
      discovery: {
        title: "Policy change",
        recommendedMaterial: { id: "material-important" },
        alternativeMaterials: [
          expect.objectContaining({ id: "material-important-analysis" }),
        ],
      },
    });
    expect(draft.trace.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          materialId: "material-shallow",
          eligible: false,
        }),
      ]),
    );
    expect(provider.lastRequest?.prompt).not.toContain("Too short.");
    expect(draft.trace.provider.tokenUsage).toEqual({
      totalTokens: 321,
      inputTokens: 200,
      cachedInputTokens: 50,
      outputTokens: 121,
      reasoningOutputTokens: 80,
    });
    expect(findKeywordPaths(provider.lastRequest?.outputSchema, "oneOf")).toEqual(
      [],
    );
  });

  it("shows the editor short material ids and restores real ids in the edition", async () => {
    const materials = [
      material("material-important", "Consequential policy change"),
      material("material-interesting", "A new view of animal cognition"),
      material("material-wildcard", "How ancient pigments were manufactured"),
    ];
    const provider = new FixtureStructuredProvider({
      slots: [
        selection("important", "policy-change", "public-policy", "m001"),
        selection(
          "personally-interesting",
          "animal-cognition",
          "cognitive-science",
          "m002",
        ),
        selection("wildcard", "ancient-pigments", "material-culture", "m003"),
      ],
      candidate_assessments: [
        assessment("policy-change", "public-policy", ["m001"]),
        assessment("animal-cognition", "cognitive-science", ["m002"]),
        assessment("ancient-pigments", "material-culture", ["m003"]),
      ],
      shortlists: [
        { role: "important", discovery_keys: ["policy-change"] },
        { role: "personally-interesting", discovery_keys: ["animal-cognition"] },
        { role: "wildcard", discovery_keys: ["ancient-pigments"] },
      ],
      decisions: ["Selected using short candidate ids."],
    });
    const editor = new AiEditionEditor({
      configuration,
      collector: { collect: async () => materials },
      provider,
    });

    const draft = await editor.generate({
      localDate: "2026-07-18",
      excludedDiscoveryIds: [],
      priorExposures: [],
      priorEnlistments: [],
      feedbackEvidence: [],
    });

    // The prompt carries short, mistake-resistant ids, not raw fingerprints.
    expect(provider.lastRequest?.prompt).toContain('"id":"m001"');
    expect(provider.lastRequest?.prompt).not.toContain('"id":"material-important"');
    // The frozen edition carries the real Material id and fingerprint.
    const important = draft.slots[0];
    expect(important?.status).toBe("filled");
    if (important?.status === "filled") {
      expect(important.discovery.recommendedMaterial.id).toBe("material-important");
      expect(important.discovery.recommendedMaterial.fingerprint).toBe(
        "material-important".padEnd(64, "0"),
      );
    }
  });

  it("totals token usage across bounded broadening selections", async () => {
    const initialMaterials = [
      material("material-important", "Consequential policy change"),
      material("material-interesting", "A new view of animal cognition"),
    ];
    const broadenedMaterial = material(
      "material-wildcard",
      "How ancient pigments were manufactured",
    );
    const firstResponse = {
      slots: [
        selection("important", "policy-change", "public-policy", "material-important"),
        selection("personally-interesting", "animal-cognition", "cognitive-science", "material-interesting"),
        { role: "wildcard", status: "unavailable", reason: "No qualified surprise yet." },
      ],
      candidate_assessments: [
        assessment("policy-change", "public-policy", ["material-important"]),
        assessment("animal-cognition", "cognitive-science", ["material-interesting"]),
      ],
      shortlists: [
        { role: "important", discovery_keys: ["policy-change"] },
        { role: "personally-interesting", discovery_keys: ["animal-cognition"] },
        { role: "wildcard", discovery_keys: [] },
      ],
      decisions: ["Needed a stronger wildcard."],
    };
    const secondResponse = {
      slots: [
        selection("important", "policy-change", "public-policy", "material-important"),
        selection("personally-interesting", "animal-cognition", "cognitive-science", "material-interesting"),
        selection("wildcard", "ancient-pigments", "material-culture", "material-wildcard"),
      ],
      candidate_assessments: [
        assessment("policy-change", "public-policy", ["material-important"]),
        assessment("animal-cognition", "cognitive-science", ["material-interesting"]),
        assessment("ancient-pigments", "material-culture", ["material-wildcard"]),
      ],
      shortlists: [
        { role: "important", discovery_keys: ["policy-change"] },
        { role: "personally-interesting", discovery_keys: ["animal-cognition"] },
        { role: "wildcard", discovery_keys: ["ancient-pigments"] },
      ],
      decisions: ["Selected a qualified wildcard after broadening."],
    };
    const editor = new AiEditionEditor({
      configuration,
      collector: {
        collect: async () => initialMaterials,
        broaden: async () => [broadenedMaterial],
      },
      provider: new SequenceStructuredProvider([firstResponse, secondResponse]),
    });

    const draft = await editor.generate({
      localDate: "2026-07-18",
      excludedDiscoveryIds: [],
      priorExposures: [],
      priorEnlistments: [],
      feedbackEvidence: [],
    });

    expect(draft.trace.provider.tokenUsage).toEqual({
      totalTokens: 642,
      inputTokens: 400,
      cachedInputTokens: 100,
      outputTokens: 242,
      reasoningOutputTokens: 160,
    });
  });
});

function findKeywordPaths(
  value: unknown,
  keyword: string,
  path = "$",
): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      findKeywordPaths(item, keyword, `${path}[${index}]`),
    );
  }
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => [
    ...(key === keyword ? [`${path}.${key}`] : []),
    ...findKeywordPaths(child, keyword, `${path}.${key}`),
  ]);
}

describe("per-edition candidate sampling", () => {
  it("bounds the candidate sample and lets every source take turns", async () => {
    const materials = [
      ...Array.from({ length: 200 }, (_, index) =>
        fromSource(material(`archive-${index}`, `Archive episode ${index}`), "archive"),
      ),
      ...Array.from({ length: 5 }, (_, index) =>
        fromSource(material(`blog-${index}`, `Blog essay ${index}`), "blog"),
      ),
    ];
    const provider = new AssessingStructuredProvider();
    const editor = new AiEditionEditor({
      configuration: withSampling({ max_candidates: 20 }),
      collector: { collect: async () => materials },
      provider,
    });

    const draft = await editor.generate(sampledRequest());
    const enlisted = promptPayload(provider).untrusted_materials;

    expect(enlisted).toHaveLength(20);
    expect(enlisted.filter((item) => item.source.id === "blog")).toHaveLength(5);
    expect(enlisted.filter((item) => item.source.id === "archive")).toHaveLength(15);
    expect(draft.trace.enlistedFingerprints).toHaveLength(20);
  });

  it("prefers Materials that have never been enlisted", async () => {
    const materials = Array.from({ length: 10 }, (_, index) =>
      material(`candidate-${index}`, `Candidate discovery ${index}`),
    );
    const provider = new AssessingStructuredProvider();
    const editor = new AiEditionEditor({
      configuration: withSampling({ max_candidates: 5 }),
      collector: { collect: async () => materials },
      provider,
    });

    const draft = await editor.generate({
      ...sampledRequest(),
      priorEnlistments: materials.slice(0, 5).map((item) => ({
        fingerprint: item.fingerprint,
        lastEnlistedAt: "2026-07-17T00:00:00.000Z",
      })),
    });

    expect(draft.trace.enlistedFingerprints).toEqual(
      materials.slice(5).map((item) => item.fingerprint),
    );
  });

  it("re-enlists a Material once its cooldown has lapsed", async () => {
    const materials = Array.from({ length: 4 }, (_, index) =>
      material(`candidate-${index}`, `Candidate discovery ${index}`),
    );
    const provider = new AssessingStructuredProvider();
    const editor = new AiEditionEditor({
      configuration: withSampling({ max_candidates: 2, enlistment_cooldown_days: 30 }),
      collector: { collect: async () => materials },
      provider,
    });

    const draft = await editor.generate({
      ...sampledRequest(),
      priorEnlistments: [
        { fingerprint: materials[0]!.fingerprint, lastEnlistedAt: "2026-01-01T00:00:00.000Z" },
        { fingerprint: materials[1]!.fingerprint, lastEnlistedAt: "2026-07-17T00:00:00.000Z" },
        { fingerprint: materials[2]!.fingerprint, lastEnlistedAt: "2026-07-16T00:00:00.000Z" },
        { fingerprint: materials[3]!.fingerprint, lastEnlistedAt: "2026-02-01T00:00:00.000Z" },
      ],
    });

    // Both lapsed Materials return, oldest first; the two still resting do not.
    expect(draft.trace.enlistedFingerprints).toEqual([
      materials[0]!.fingerprint,
      materials[3]!.fingerprint,
    ]);
  });

  it("truncates Material content for assessment without shortening the Material", async () => {
    const long = {
      ...material("long-material", "A very long recorded conversation"),
      content: "sentence ".repeat(2000),
      estimatedMinutes: 182,
    };
    const provider = new AssessingStructuredProvider();
    const editor = new AiEditionEditor({
      configuration: withSampling({ max_material_chars: 500 }),
      collector: { collect: async () => [long] },
      provider,
    });

    await editor.generate(sampledRequest());
    const enlisted = promptPayload(provider).untrusted_materials[0];

    expect(enlisted?.content).toContain("[Material truncated for editorial assessment");
    expect(enlisted?.content.length).toBeLessThan(700);
    expect(enlisted?.estimated_minutes).toBe(182);
  });
});

function sampledRequest() {
  return {
    localDate: "2026-07-18",
    excludedDiscoveryIds: [],
    priorExposures: [],
    priorEnlistments: [],
    feedbackEvidence: [],
  };
}

function fromSource(item: CollectedMaterial, sourceId: string): CollectedMaterial {
  return { ...item, source: { id: sourceId, name: sourceId } };
}

function withSampling(
  overrides: Partial<MusementConfiguration["edition_sampling"]>,
): MusementConfiguration {
  return {
    ...configuration,
    edition_sampling: { ...configuration.edition_sampling, ...overrides },
  };
}

function promptPayload(provider: AssessingStructuredProvider): {
  untrusted_materials: Array<{
    content: string;
    estimated_minutes: number;
    source: { id: string };
  }>;
} {
  const prompt = provider.lastRequest?.prompt ?? "";
  return JSON.parse(prompt.slice(prompt.indexOf('{"local_date"')));
}

/**
 * Answers whatever candidate sample it is given: every enlisted Material is
 * assessed and found short of every role, so the sample itself is what the
 * sampling tests observe.
 */
class AssessingStructuredProvider {
  lastRequest: StructuredCompletionRequest | null = null;

  async completeStructured<T>(
    request: StructuredCompletionRequest,
  ): Promise<StructuredCompletion<T>> {
    this.lastRequest = request;
    const payload = JSON.parse(
      request.prompt.slice(request.prompt.indexOf('{"local_date"')),
    ) as { untrusted_materials: Array<{ id: string }> };
    return {
      value: {
        slots: selectionSlotRoleNames.map((role) => ({
          role,
          status: "unavailable",
          reason: "No candidate met the quality floor in this sample.",
        })),
        candidate_assessments: payload.untrusted_materials.map((item) => ({
          discovery_key: item.id,
          topic_key: `topic-${item.id}`,
          title: item.id.replaceAll("-", " "),
          material_ids: [item.id],
          evidence_status: "Supported by supplied Materials.",
          uncertainty: null,
          role_assessments: selectionSlotRoleNames.map((role) => ({
            role,
            eligible: false,
            rationale: "Below the quality floor for this role.",
          })),
        })),
        shortlists: selectionSlotRoleNames.map((role) => ({
          role,
          discovery_keys: [],
        })),
        decisions: ["No slot could be filled from this sample."],
      } as T,
      trace: { provider: "fixture", model: "fixture-model" },
    };
  }
}

const selectionSlotRoleNames = [
  "important",
  "personally-interesting",
  "wildcard",
] as const;

class FixtureStructuredProvider {
  lastRequest: StructuredCompletionRequest | null = null;

  constructor(private readonly response: unknown) {}

  async completeStructured<T>(
    request: StructuredCompletionRequest,
  ): Promise<StructuredCompletion<T>> {
    this.lastRequest = request;
    return {
      value: this.response as T,
      trace: {
        provider: "fixture",
        model: "fixture-model",
        tokenUsage: {
          totalTokens: 321,
          inputTokens: 200,
          cachedInputTokens: 50,
          outputTokens: 121,
          reasoningOutputTokens: 80,
        },
      },
    };
  }
}

class SequenceStructuredProvider {
  #index = 0;

  constructor(private readonly responses: unknown[]) {}

  async completeStructured<T>(): Promise<StructuredCompletion<T>> {
    const response = this.responses[this.#index];
    this.#index += 1;
    return {
      value: response as T,
      trace: {
        provider: "fixture",
        model: "fixture-model",
        tokenUsage: {
          totalTokens: 321,
          inputTokens: 200,
          cachedInputTokens: 50,
          outputTokens: 121,
          reasoningOutputTokens: 80,
        },
      },
    };
  }
}

function material(id: string, title: string): CollectedMaterial {
  return {
    id,
    fingerprint: id.padEnd(64, "0"),
    title,
    url: `https://example.com/${id}`,
    author: "Example Author",
    publishedAt: "2026-07-17T00:00:00.000Z",
    format: "article",
    summary:
      "A detailed summary with enough context to support an initial editorial assessment of this source material.",
    content:
      "This is substantive source content with enough detail for a careful editorial assessment. It includes context, supporting evidence, uncertainty, and enough explanation to exceed the coded minimum quality floor for consideration.",
    estimatedMinutes: 12,
    source: { id: "example", name: "Example" },
    provenance: [
      "https://example.com/feed.xml",
      `https://example.com/${id}`,
    ],
    referencedUrls: [],
  };
}

function selection(
  role: "important" | "personally-interesting" | "wildcard",
  discoveryKey: string,
  topicKey: string,
  materialId: string,
  alternativeMaterialIds: string[] = [],
) {
  const title = discoveryKey
    .split("-")
    .map((part, index) =>
      index === 0 ? `${part[0]?.toUpperCase()}${part.slice(1)}` : part,
    )
    .join(" ");
  return {
    role,
    status: "filled",
    discovery_key: discoveryKey,
    topic_key: topicKey,
    title,
    summary: `${title} explained in one sentence.`,
    slot_reason: `This distinctly satisfies the ${role} role.`,
    evidence_status: "Supported by the recommended Material.",
    recommended_material_id: materialId,
    alternative_material_ids: alternativeMaterialIds,
    meaningful_entry: "Read the opening explanation and evidence section.",
    meaningful_entry_minutes: 8,
    uncertainty: null,
  };
}

function assessment(
  discoveryKey: string,
  topicKey: string,
  materialIds: string[],
) {
  return {
    discovery_key: discoveryKey,
    topic_key: topicKey,
    title: discoveryKey.replaceAll("-", " "),
    material_ids: materialIds,
    evidence_status: "Supported by supplied Materials.",
    uncertainty: null,
    role_assessments: [
      { role: "important", eligible: true, rationale: "Assessed for importance." },
      { role: "personally-interesting", eligible: true, rationale: "Assessed for curiosity fit." },
      { role: "wildcard", eligible: true, rationale: "Assessed for exploratory value." },
    ],
  };
}

const configuration: MusementConfiguration = {
  version: 1,
  timezone: "Asia/Shanghai",
  attention_budget_minutes: 25,
  provider_timeout_seconds: 300,
  cache_retention_days: 7,
  edition_sampling: {
    max_candidates: 120,
    max_material_chars: 4000,
    enlistment_cooldown_days: 30,
  },
  interest_profile: {
    enduring: [
      {
        label: "Cognitive science",
        description: "Ideas that change how I understand minds.",
        examples: [],
      },
    ],
    current: [],
    soft_suppressions: [],
  },
  sources: [
    {
      id: "example",
      name: "Example",
      kind: "rss",
      url: "https://example.com/feed.xml",
      enabled: true,
    },
  ],
};

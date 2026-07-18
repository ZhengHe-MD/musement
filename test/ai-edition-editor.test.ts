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
  });
});

class FixtureStructuredProvider {
  lastRequest: StructuredCompletionRequest | null = null;

  constructor(private readonly response: unknown) {}

  async completeStructured<T>(
    request: StructuredCompletionRequest,
  ): Promise<StructuredCompletion<T>> {
    this.lastRequest = request;
    return {
      value: this.response as T,
      trace: { provider: "fixture", model: "fixture-model" },
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

const configuration: MusementConfiguration = {
  version: 1,
  timezone: "Asia/Shanghai",
  attention_budget_minutes: 25,
  cache_retention_days: 7,
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

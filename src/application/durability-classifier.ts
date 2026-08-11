import { z } from "zod";

import type {
  CandidatePoolItem,
  CollectedMaterial,
  DurabilityTier,
} from "../domain/contracts.js";
import type {
  StructuredCompletionRequest,
  StructuredProvider,
} from "../infrastructure/codex-app-server-provider.js";

export interface DurabilityClassifierDependencies {
  provider?: StructuredProvider | undefined;
}

const itemClassificationSchema = z.object({
  id: z.string().trim().min(1),
  durability_tier: z.enum(["evergreen", "emerging", "horizon"]),
  rationale: z.string().trim().min(1),
});

const batchClassificationResponseSchema = z.object({
  items: z.array(itemClassificationSchema),
});

type BatchClassificationResponse = z.infer<
  typeof batchClassificationResponseSchema
>;

function codexCompatibleSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "$schema") continue;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      result[key] = codexCompatibleSchema(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        item !== null && typeof item === "object"
          ? codexCompatibleSchema(item as Record<string, unknown>)
          : item,
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

const { $schema: _schemaDialect, ...classificationOutputSchema } =
  codexCompatibleSchema(z.toJSONSchema(batchClassificationResponseSchema));

export class DurabilityClassifier {
  readonly #provider: StructuredProvider | null;

  constructor(dependencies: DurabilityClassifierDependencies = {}) {
    this.#provider = dependencies.provider ?? null;
  }

  async classifyMaterials(
    materials: Array<CandidatePoolItem | CollectedMaterial>,
  ): Promise<Map<string, DurabilityTier>> {
    const results = new Map<string, DurabilityTier>();
    if (materials.length === 0) {
      return results;
    }

    if (this.#provider === null) {
      for (const m of materials) {
        results.set(m.fingerprint, heuristicClassification(m));
      }
      return results;
    }

    // Process in batches of 25
    const batchSize = 25;
    for (let i = 0; i < materials.length; i += batchSize) {
      const batch = materials.slice(i, i + batchSize);
      try {
        const batchResults = await this.#classifyBatchWithAI(batch);
        for (const [fp, tier] of batchResults.entries()) {
          results.set(fp, tier);
        }
      } catch {
        // Fallback to heuristic for this batch if AI fails
        for (const item of batch) {
          results.set(item.fingerprint, heuristicClassification(item));
        }
      }
    }

    return results;
  }

  async #classifyBatchWithAI(
    batch: Array<CandidatePoolItem | CollectedMaterial>,
  ): Promise<Map<string, DurabilityTier>> {
    const results = new Map<string, DurabilityTier>();
    const prompt = buildClassificationPrompt(batch);

    const completionRequest: StructuredCompletionRequest = {
      prompt,
      outputSchema: classificationOutputSchema,
      effort: "medium",
    };

    const completion = await this.#provider!.completeStructured<unknown>(
      completionRequest,
    );
    const response = batchClassificationResponseSchema.parse(completion.value);

    for (const item of response.items) {
      results.set(item.id, item.durability_tier);
    }

    // Ensure all items in batch have a result
    for (const item of batch) {
      if (!results.has(item.fingerprint)) {
        results.set(item.fingerprint, heuristicClassification(item));
      }
    }

    return results;
  }
}

function buildClassificationPrompt(
  items: Array<CandidatePoolItem | CollectedMaterial>,
): string {
  const itemList = items
    .map((item, index) => {
      const sourceName = "sourceName" in item ? item.sourceName : item.source.name;
      return `### Item ${index + 1}
ID: ${item.fingerprint}
Title: ${item.title}
Source: ${sourceName}
Format: ${item.format} (${item.estimatedMinutes} min)
Author: ${item.author ?? "Unknown"}
Summary: ${item.summary.slice(0, 300)}
`;
    })
    .join("\n");

  return `You are an editorial knowledge classifier for Musement.
Musement organizes materials into a 3-tier Knowledge Durability Pyramid based on their epistemic half-life:

1. "evergreen" (Base / Decadal):
   - Timeless principles, foundational science, enduring philosophy, history, foundational mathematics, classic mental models, and deep ideas that retain value across decades.
2. "emerging" (Middle / Multi-Year to Monthly):
   - Substantial analyses, paradigm shifts, architectural discussions, in-depth podcast dialogues (e.g. Dwarkesh Patel, deep research conversations), and multi-year structural trends that remain relevant across months to years.
3. "horizon" (Top / Daily to Weekly):
   - Fast-changing news, immediate product announcements, current event updates, transient commentary, and fast-moving tangents whose utility can expire within days or weeks.

Given the list of candidate materials below, classify each item into exactly one durability tier ("evergreen", "emerging", or "horizon") with a short 1-sentence rationale.

${itemList}`;
}

export function heuristicClassification(
  item: CandidatePoolItem | CollectedMaterial,
): DurabilityTier {
  const text = `${item.title} ${item.summary}`.toLowerCase();
  const format = item.format;
  const minutes = item.estimatedMinutes;

  // Horizon triggers: fast releases, daily news, short changelogs
  if (
    text.includes("announcing ") ||
    text.includes("release notes") ||
    text.includes("v0.") ||
    text.includes("v1.") ||
    text.includes("v2.") ||
    text.includes("show hn:") ||
    text.includes("breaking:") ||
    (minutes <= 8 && text.includes("launch"))
  ) {
    return "horizon";
  }

  // Evergreen triggers: timeless philosophy, fundamentals, history
  if (
    text.includes("foundations") ||
    text.includes("principles") ||
    text.includes("history of") ||
    text.includes("classic") ||
    text.includes("fundamental") ||
    text.includes("mental model") ||
    format === "lecture" ||
    format === "paper"
  ) {
    return "evergreen";
  }

  // Podcasts and long-form deep dives are typically emerging or evergreen
  if (format === "podcast" || minutes >= 25) {
    return "emerging";
  }

  return "emerging";
}

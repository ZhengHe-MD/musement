import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

import type { MusementConfiguration } from "../config/configuration.js";
import type {
  CandidatePoolItem,
  CuratedEncounter,
  CuratedPullRequest,
  DurabilityTier,
  SelectedDiscovery,
  SelectionTrace,
} from "../domain/contracts.js";
import type {
  StructuredCompletionRequest,
  StructuredProvider,
} from "../infrastructure/codex-app-server-provider.js";

export interface OnlinePullEditorDependencies {
  configuration: MusementConfiguration;
  provider: StructuredProvider;
}

const pullDiscoveryItemSchema = z.object({
  discovery_key: z.string().trim().min(1),
  topic_key: z.string().trim().min(1),
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  slot_reason: z.string().trim().min(1),
  evidence_status: z.string().trim().min(1),
  recommended_material_id: z.string().trim().min(1),
  alternative_material_ids: z.array(z.string().trim().min(1)),
  meaningful_entry: z.string().trim().min(1),
  meaningful_entry_minutes: z.number().int().positive(),
  uncertainty: z.string().trim().min(1).nullable(),
});

const pullEditorialResponseSchema = z.object({
  discoveries: z.array(pullDiscoveryItemSchema),
  decisions: z.array(z.string()),
});

type PullEditorialResponse = z.infer<typeof pullEditorialResponseSchema>;

const { $schema: _schemaDialect, ...pullOutputSchema } =
  codexCompatibleSchema(z.toJSONSchema(pullEditorialResponseSchema));

export class OnlinePullEditor {
  readonly #configuration: MusementConfiguration;
  readonly #provider: StructuredProvider;

  constructor(dependencies: OnlinePullEditorDependencies) {
    this.#configuration = dependencies.configuration;
    this.#provider = dependencies.provider;
  }

  async selectCuratedEncounter(options: {
    poolMaterials: CandidatePoolItem[];
    request: CuratedPullRequest;
    now: Date;
  }): Promise<CuratedEncounter> {
    const { poolMaterials, request, now } = options;
    const requestedCount = Math.max(1, Math.min(request.count || 3, 10));

    if (poolMaterials.length === 0) {
      return {
        id: randomUUID(),
        pulledAt: now.toISOString(),
        direction: request.direction ?? null,
        count: 0,
        discoveries: [],
        trace: {
          candidates: [],
          decisions: ["Candidate pool is empty; no unexposed materials available."],
          provider: {
            name: "local",
            model: "none",
            promptVersion: "online-pull-v1",
            schemaVersion: "1",
          },
        },
      };
    }

    // Stage 1: Keywords Fetch First
    let candidateSample: CandidatePoolItem[];
    if (request.direction && request.direction.trim().length > 0) {
      candidateSample = sampleByKeywordsAndRelevance({
        poolMaterials,
        query: request.direction,
        durabilityTier: request.durabilityTier,
        limit: Math.min(this.#configuration.edition_sampling.max_candidates, 60),
      });
    } else if (request.durabilityTier) {
      candidateSample = poolMaterials
        .filter((m) => m.durabilityTier === request.durabilityTier)
        .slice(0, Math.min(this.#configuration.edition_sampling.max_candidates, 60));
    } else {
      candidateSample = sampleStratifiedByTier(
        poolMaterials,
        Math.min(this.#configuration.edition_sampling.max_candidates, 60),
      );
    }

    if (candidateSample.length === 0) {
      candidateSample = poolMaterials.slice(
        0,
        Math.min(this.#configuration.edition_sampling.max_candidates, 60),
      );
    }

    const realIdByShortId = new Map<string, string>();
    const materialByShortId = new Map<string, CandidatePoolItem>();
    const materialByFingerprint = new Map<string, CandidatePoolItem>();

    candidateSample.forEach((material, index) => {
      const shortId = `m${String(index + 1).padStart(3, "0")}`;
      realIdByShortId.set(shortId, material.fingerprint);
      materialByShortId.set(shortId, material);
      materialByFingerprint.set(material.fingerprint, material);
    });

    // Stage 2: Prompt Order Second (AI editorial evaluation)
    const prompt = this.#buildPrompt({
      candidateSample,
      requestedCount,
      direction: request.direction,
      durabilityTier: request.durabilityTier,
    });

    const completionRequest: StructuredCompletionRequest = {
      prompt,
      outputSchema: pullOutputSchema,
      effort: "high",
    };

    const completion = await this.#provider.completeStructured<unknown>(completionRequest);
    const response = pullEditorialResponseSchema.parse(completion.value);

    // Restore real IDs and validate
    restoreMaterialIds(response, realIdByShortId);

    const discoveries = assembleDiscoveries({
      response,
      materialByFingerprint,
      attentionBudgetMinutes: this.#configuration.attention_budget_minutes,
      requestedCount,
    });

    const trace: SelectionTrace = {
      candidates: candidateSample.map((c) => ({
        fingerprint: c.fingerprint,
        title: c.title,
        source: c.sourceName,
        author: c.author,
        url: c.url,
      })),
      decisions: response.decisions,
      provider: {
        name: completion.trace.provider,
        model: completion.trace.model,
        promptVersion: "online-pull-v1",
        schemaVersion: "1",
        ...(completion.trace.tokenUsage ? { tokenUsage: completion.trace.tokenUsage } : {}),
      },
    };

    return {
      id: randomUUID(),
      pulledAt: now.toISOString(),
      direction: request.direction ?? null,
      count: discoveries.length,
      discoveries,
      trace,
    };
  }

  #buildPrompt(options: {
    candidateSample: CandidatePoolItem[];
    requestedCount: number;
    direction?: string | undefined;
    durabilityTier?: DurabilityTier | undefined;
  }): string {
    const { candidateSample, requestedCount, direction, durabilityTier } = options;
    const maxChars = this.#configuration.edition_sampling.max_material_chars;

    const materialsBlock = candidateSample
      .map((item, index) => {
        const shortId = `m${String(index + 1).padStart(3, "0")}`;
        const excerpt =
          item.content.length <= maxChars
            ? item.content
            : `${item.content.slice(0, maxChars)}...`;
        return `### [${shortId}] ${item.title}
- Source: ${item.sourceName} (${item.format}) [Tier: ${item.durabilityTier ?? "emerging"}]
- Author: ${item.author ?? "Unknown"}
- Published: ${item.publishedAt ?? "Unknown"}
- Estimated Duration: ${item.estimatedMinutes} min
- Summary: ${item.summary}
- Excerpt:
${excerpt}`;
      })
      .join("\n\n");

    const enduring = this.#configuration.interest_profile.enduring
      .map((s) => `- ${s.label}: ${s.description}`)
      .join("\n");
    const current = this.#configuration.interest_profile.current
      .map((s) => `- ${s.label}: ${s.description}`)
      .join("\n");
    const softSuppressions = this.#configuration.interest_profile.soft_suppressions
      .map((s) => `- ${s}`)
      .join("\n");

    const tierConstraint = durabilityTier
      ? `Constrained to "${durabilityTier}" tier.`
      : "Any Knowledge Durability Pyramid tier (Evergreen, Emerging, Horizon).";

    return `# Musement Online Editorial Pull

You are the AI editor for Musement, an on-demand personal knowledge-exploration system.
Your mission is to curate the highest quality, most intellectually rewarding encounters from the candidate pool.

## User Profile
### Enduring Interests:
${enduring || "(None specified)"}

### Current Interests:
${current || "(None specified)"}

### Soft Suppressions (de-prioritize unless exceptional):
${softSuppressions || "(None)"}

## Request Parameters
- **Target Selection Count**: Up to ${requestedCount} distinct Discoveries.
- **Dynamic Curiosity Direction**: ${direction ? `"${direction}"` : "Open Exploration (no specific topic restriction; balance quality, novelty, and interest profile)"}
- **Knowledge Durability Filter**: ${tierConstraint}

## Editorial Directives
1. **Direction & Question Fit**: ${direction ? `Actively evaluate candidate materials against the user's inquiry "${direction}". Select materials that directly answer, illuminate, or provide rich depth on this question/topic.` : "Balance items across enduring curiosity, significant wider-world consequence, and unexpected wildcard novelty."}
2. **Quality Floor**: Never lower the quality floor to reach the target count. If only 1 or 2 items meet high substance and intellectual value standards, return only those.
3. **Clustering**: If multiple candidate materials discuss the exact same underlying subject/event, cluster them into one Discovery with one recommended material and the others as alternative materials.
4. **Substance & Novelty**: Avoid shallow listicles, superficial clickbait, or trivial announcements. Favor analytical depth, first-principles insight, and genuine intellectual novelty.
5. **Inspectable Explanations**: Provide clear, concise reasons in \`slot_reason\` (explaining why this material answers the user's question or warrants attention) and \`evidence_status\` (noting certainty or caveats).

## Candidate Materials (${candidateSample.length} available)
${materialsBlock}

Return your selections in the structured schema with \`discoveries\` (array of at most ${requestedCount} items) and \`decisions\` (short notes explaining why these were chosen over other candidates).`;
  }
}

function restoreMaterialIds(
  response: PullEditorialResponse,
  realIdByShortId: ReadonlyMap<string, string>,
): void {
  const toReal = (id: string): string => realIdByShortId.get(id) ?? id;
  for (const item of response.discoveries) {
    item.recommended_material_id = toReal(item.recommended_material_id);
    item.alternative_material_ids = item.alternative_material_ids.map(toReal);
  }
}

function assembleDiscoveries(options: {
  response: PullEditorialResponse;
  materialByFingerprint: Map<string, CandidatePoolItem>;
  attentionBudgetMinutes: number;
  requestedCount: number;
}): SelectedDiscovery[] {
  const { response, materialByFingerprint, attentionBudgetMinutes, requestedCount } =
    options;
  const results: SelectedDiscovery[] = [];
  const seenFingerprints = new Set<string>();

  for (const item of response.discoveries) {
    if (results.length >= requestedCount) break;
    const mainMaterial = materialByFingerprint.get(item.recommended_material_id);
    if (!mainMaterial || seenFingerprints.has(mainMaterial.fingerprint)) {
      continue;
    }
    seenFingerprints.add(mainMaterial.fingerprint);

    const alternativeMaterials = item.alternative_material_ids.flatMap((altId) => {
      const alt = materialByFingerprint.get(altId);
      if (!alt || seenFingerprints.has(alt.fingerprint)) return [];
      seenFingerprints.add(alt.fingerprint);
      return [
        {
          id: alt.fingerprint,
          fingerprint: alt.fingerprint,
          title: alt.title,
          author: alt.author ?? "Unknown",
          source: alt.sourceName,
          format: alt.format,
          url: alt.url,
          provenance: alt.provenance,
        },
      ];
    });

    const meaningfulEntryMinutes = Math.min(
      mainMaterial.estimatedMinutes,
      item.meaningful_entry_minutes || attentionBudgetMinutes,
    );

    const discoveryId = createHash("sha256")
      .update(`${item.discovery_key}:${mainMaterial.fingerprint}`)
      .digest("hex")
      .slice(0, 16);

    results.push({
      id: discoveryId,
      subjectKey: item.topic_key,
      subjectTerms: [item.topic_key, mainMaterial.sourceName],
      title: item.title,
      summary: item.summary,
      slotReason: item.slot_reason,
      evidenceStatus: item.evidence_status,
      recommendedMaterial: {
        id: mainMaterial.fingerprint,
        fingerprint: mainMaterial.fingerprint,
        title: mainMaterial.title,
        author: mainMaterial.author ?? "Unknown",
        source: mainMaterial.sourceName,
        format: mainMaterial.format,
        url: mainMaterial.url,
        meaningfulEntryMinutes,
        fullLengthMinutes: mainMaterial.estimatedMinutes,
        provenance: mainMaterial.provenance,
        meaningfulEntry: item.meaningful_entry,
        ...(item.uncertainty ? { uncertainty: item.uncertainty } : {}),
      },
      alternativeMaterials,
    });
  }

  return results;
}

export function sampleByKeywordsAndRelevance(options: {
  poolMaterials: CandidatePoolItem[];
  query: string;
  durabilityTier?: DurabilityTier | undefined;
  limit: number;
}): CandidatePoolItem[] {
  const { poolMaterials, query, durabilityTier, limit } = options;
  const keywords = extractKeywords(query);

  let filtered = poolMaterials;
  if (durabilityTier) {
    filtered = filtered.filter((m) => m.durabilityTier === durabilityTier);
  }

  if (keywords.length === 0) {
    return filtered.slice(0, limit);
  }

  // Score each material by keyword matches in title (3x), summary (2x), content (1x)
  const scored = filtered.map((m) => {
    let score = 0;
    const titleLower = m.title.toLowerCase();
    const summaryLower = m.summary.toLowerCase();
    const contentLower = m.content.toLowerCase();

    for (const kw of keywords) {
      if (titleLower.includes(kw)) score += 5;
      if (summaryLower.includes(kw)) score += 3;
      if (contentLower.includes(kw)) score += 1;
    }
    return { material: m, score };
  });

  scored.sort((a, b) => b.score - a.score);

  const matched = scored.filter((s) => s.score > 0).map((s) => s.material);
  if (matched.length >= limit) {
    return matched.slice(0, limit);
  }

  // If matched fewer than limit, backfill with diverse recent items
  const result = [...matched];
  const seen = new Set(matched.map((m) => m.fingerprint));
  for (const item of filtered) {
    if (result.length >= limit) break;
    if (!seen.has(item.fingerprint)) {
      seen.add(item.fingerprint);
      result.push(item);
    }
  }

  return result;
}

export function sampleStratifiedByTier(
  materials: CandidatePoolItem[],
  limit: number,
): CandidatePoolItem[] {
  const evergreen = materials.filter((m) => m.durabilityTier === "evergreen");
  const emerging = materials.filter((m) => m.durabilityTier === "emerging");
  const horizon = materials.filter((m) => m.durabilityTier === "horizon");

  const result: CandidatePoolItem[] = [];
  const seen = new Set<string>();

  const maxRounds = Math.max(evergreen.length, emerging.length, horizon.length);
  for (let r = 0; r < maxRounds && result.length < limit; r++) {
    const em = emerging[r];
    if (em !== undefined && !seen.has(em.fingerprint) && result.length < limit) {
      seen.add(em.fingerprint);
      result.push(em);
    }
    const ev = evergreen[r];
    if (ev !== undefined && !seen.has(ev.fingerprint) && result.length < limit) {
      seen.add(ev.fingerprint);
      result.push(ev);
    }
    const hz = horizon[r];
    if (hz !== undefined && !seen.has(hz.fingerprint) && result.length < limit) {
      seen.add(hz.fingerprint);
      result.push(hz);
    }
  }

  // Backfill if needed
  for (const item of materials) {
    if (result.length >= limit) break;
    if (!seen.has(item.fingerprint)) {
      seen.add(item.fingerprint);
      result.push(item);
    }
  }

  return result;
}

export function extractKeywords(query: string): string[] {
  const stopWords = new Set([
    "what", "is", "the", "are", "about", "for", "how", "why", "who", "when",
    "where", "which", "in", "on", "with", "and", "or", "to", "of", "a", "an",
    "by", "at", "from", "as", "into", "through", "during", "latest", "recent",
    "show", "me", "find", "get", "explore", "tell", "explain", "i", "want",
  ]);

  return query
    .toLowerCase()
    .replace(/[^\w\s\u4e00-\u9fa5]/gi, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && !stopWords.has(w));
}

function codexCompatibleSchema(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return rewriteSchemaNode(value) as Record<string, unknown>;
}

function rewriteSchemaNode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(rewriteSchemaNode);
  if (typeof value !== "object" || value === null) return value;

  const rewritten: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    rewritten[key === "oneOf" ? "anyOf" : key] = rewriteSchemaNode(child);
  }
  return rewritten;
}


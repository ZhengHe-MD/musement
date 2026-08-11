import { randomUUID } from "node:crypto";

import {
  type Clock,
  type DailyEdition,
  type DailyEditionDraft,
  type DiscoverySelectedEvent,
  type EditionEditor,
  type EditionStore,
  type GenerationAttempt,
  type FeedbackKind,
  type InterestProfileUpdater,
  type NotUsefulReason,
  type MvpEvaluation,
  type MvpEvaluationDiscovery,
  type MvpEvaluationReview,
  type PreferenceProposal,
  type QuickFeedback,
  type SelectionSlotRole,
  selectionSlotRoles,
  type CandidateSnapshot,
  type CandidatePoolItem,
  type CandidatePoolSourceSummary,
  type CuratedEncounter,
  type SelectedDiscovery,
  type DurabilityTier,
} from "../domain/contracts.js";
import type { MaterialCollector } from "./ai-edition-editor.js";
import type { OnlinePullEditor } from "./online-pull-editor.js";
import { DurabilityClassifier } from "./durability-classifier.js";
import type { GitHubRssPublisher } from "../infrastructure/github-rss-publisher.js";
import type { MusementConfiguration } from "../config/configuration.js";
import { localDateInTimezone } from "../local-date.js";

export interface MusementDependencies {
  store: EditionStore;
  editor: EditionEditor;
  clock: Clock;
  timezone: string;
  interestProfile?: InterestProfileUpdater | undefined;
  collector?: MaterialCollector | undefined;
  pullEditor?: OnlinePullEditor | undefined;
  classifier?: DurabilityClassifier | undefined;
  rssPublisher?: GitHubRssPublisher | undefined;
  configuration?: MusementConfiguration | undefined;
}

export class Musement {
  readonly #store: EditionStore;
  readonly #editor: EditionEditor;
  readonly #clock: Clock;
  readonly #timezone: string;
  readonly #interestProfile: InterestProfileUpdater | null;
  readonly #collector: MaterialCollector | null;
  readonly #pullEditor: OnlinePullEditor | null;
  readonly #classifier: DurabilityClassifier | null;
  readonly #rssPublisher: GitHubRssPublisher | null;
  readonly #configuration: MusementConfiguration | null;

  constructor(dependencies: MusementDependencies) {
    this.#store = dependencies.store;
    this.#editor = dependencies.editor;
    this.#clock = dependencies.clock;
    this.#timezone = dependencies.timezone;
    this.#interestProfile = dependencies.interestProfile ?? null;
    this.#collector = dependencies.collector ?? null;
    this.#pullEditor = dependencies.pullEditor ?? null;
    this.#classifier = dependencies.classifier ?? new DurabilityClassifier();
    this.#rssPublisher = dependencies.rssPublisher ?? null;
    this.#configuration = dependencies.configuration ?? null;
  }

  async viewToday(): Promise<DailyEdition> {
    const now = this.#clock.now();
    const localDate = localDateInTimezone(now, this.#timezone);
    const existingEdition = this.#store.findEdition(localDate);
    if (existingEdition !== null) {
      return existingEdition;
    }

    const attempt: GenerationAttempt = {
      id: randomUUID(),
      localDate,
      status: "pending",
      startedAt: now.toISOString(),
      finishedAt: null,
      failureReason: null,
    };
    this.#store.beginGenerationAttempt(attempt);

    try {
      const excludedDiscoveryIds = this.#store.listExposedDiscoveryIds();
      const priorExposures = this.#store.listExposureEvidence();
      const draft = await this.#editor.generate({
        localDate,
        excludedDiscoveryIds,
        priorExposures,
        priorEnlistments: this.#store.listEnlistmentEvidence(),
        feedbackEvidence: this.#store.listFeedbackEvidence(),
      });
      assertValidDraft(draft, localDate, priorExposures);
      this.#store.recordEnlistments(
        draft.trace.enlistedFingerprints ?? [],
        now.toISOString(),
      );

      const snapshots: CandidateSnapshot[] = (draft.trace.candidates as any[]).map((c: any) => ({
        fingerprint: c.fingerprint,
        sourceId: c.source.id,
        sourceName: c.source.name,
        title: c.title,
        url: c.url,
        author: c.author ?? null,
        publishedAt: c.publishedAt ?? null,
        fetchedAt: now.toISOString(),
        estimatedMinutes: c.estimatedMinutes ?? 0,
        contentLength: c.contentLength ?? 0,
        eligible: c.eligible,
        ruleOutcomes: c.ruleOutcomes ?? [],
      }));
      this.#store.saveCandidateSnapshot(localDate, snapshots);

      const eligibleCount = snapshots.filter((c) => c.eligible).length;
      let editionQuality: "normal" | "low-signal-day" | "source-gap" = "normal";
      const unavailableCount = draft.slots.filter((s) => s.status === "unavailable").length;
      if (unavailableCount === 3) {
        editionQuality = "low-signal-day";
      } else if (unavailableCount > 0 && eligibleCount < 3) {
        editionQuality = "source-gap";
      }

      for (const slot of draft.slots) {
        if (slot.status === "unavailable") {
          slot.degradationCause = eligibleCount < 3 ? "source-poverty" : "quality-floor";
          slot.candidatesEvaluated = eligibleCount;
        }
      }

      const edition: DailyEdition = {
        ...draft,
        id: randomUUID(),
        generatedAt: now.toISOString(),
        status: unavailableCount > 0 ? "degraded" : "complete",
        editionQuality,
      };

      const canonicalEdition = this.#store.saveCanonicalEdition(edition);
      this.#store.finishGenerationAttempt(attempt.id, {
        status: "succeeded",
        finishedAt: this.#clock.now().toISOString(),
        ...(draft.generationMetrics ? { metrics: draft.generationMetrics } : {}),
      });
      return canonicalEdition;
    } catch (error) {
      this.#store.finishGenerationAttempt(attempt.id, {
        status: "failed",
        finishedAt: this.#clock.now().toISOString(),
        failureReason: errorMessage(error),
      });
      throw error;
    }
  }

  generationAttempts(localDate: string): GenerationAttempt[] {
    return this.#store.listGenerationAttempts(localDate);
  }

  edition(localDate: string): DailyEdition | null {
    return this.#store.findEdition(localDate);
  }

  candidateSnapshot(localDate: string): CandidateSnapshot[] {
    return this.#store.loadCandidateSnapshot(localDate);
  }

  selectDiscovery(input: {
    localDate: string;
    role: SelectionSlotRole;
  }): DiscoverySelectedEvent {
    const edition = this.#store.findEdition(input.localDate);
    if (edition === null) {
      throw new Error(`No Daily Edition exists for ${input.localDate}.`);
    }
    const slot = edition.slots.find((candidate) => candidate.role === input.role);
    if (slot === undefined || slot.status === "unavailable") {
      throw new Error(
        `The ${input.role} Selection Slot is unavailable for ${input.localDate}.`,
      );
    }

    const material = slot.discovery.recommendedMaterial;
    return this.#store.appendHandoffEvent({
      event_id: randomUUID(),
      event_type: "DiscoverySelected",
      event_version: 1,
      occurred_at: this.#clock.now().toISOString(),
      data: {
        edition: {
          id: edition.id,
          local_date: edition.localDate,
        },
        selection_slot: input.role,
        discovery: {
          id: slot.discovery.id,
          title: slot.discovery.title,
          summary: slot.discovery.summary,
          evidence_status: slot.discovery.evidenceStatus,
        },
        recommended_material: {
          id: material.id,
          title: material.title,
          author: material.author,
          source: material.source,
          format: material.format,
          url: material.url,
          provenance: material.provenance,
          ...(material.meaningfulEntry === undefined
            ? {}
            : { meaningful_entry: material.meaningfulEntry }),
          meaningful_entry_minutes: material.meaningfulEntryMinutes,
          full_length_minutes: material.fullLengthMinutes,
        },
      },
    });
  }

  readHandoffEvents(input: {
    afterPosition: number;
    limit?: number;
  }): DiscoverySelectedEvent[] {
    return this.#store.readHandoffEvents(input.afterPosition, input.limit ?? 100);
  }

  recordFeedback(input: {
    localDate: string;
    role: SelectionSlotRole;
    kind: FeedbackKind;
    reason?: NotUsefulReason;
  }): { feedback: QuickFeedback; proposal: PreferenceProposal | null } {
    const edition = this.#store.findEdition(input.localDate);
    if (edition === null) {
      throw new Error(`No Daily Edition exists for ${input.localDate}.`);
    }
    const slot = edition.slots.find((candidate) => candidate.role === input.role);
    if (slot === undefined || slot.status === "unavailable") {
      throw new Error(
        `The ${input.role} Selection Slot is unavailable for ${input.localDate}.`,
      );
    }
    if (input.kind !== "not-useful" && input.reason !== undefined) {
      throw new Error("Only Not useful feedback accepts a reason.");
    }
    const now = this.#clock.now().toISOString();
    const feedback: QuickFeedback = {
      id: randomUUID(),
      editionId: edition.id,
      discoveryId: slot.discovery.id,
      localDate: edition.localDate,
      role: slot.role,
      kind: input.kind,
      reason: input.reason ?? null,
      recordedAt: now,
    };
    this.#store.recordFeedback(feedback);

    let proposal: PreferenceProposal | null = null;
    if (input.kind === "not-useful" && input.reason === "topic") {
      proposal = {
        id: randomUUID(),
        status: "pending",
        explanation:
          "You marked this Discovery as not useful because of its topic. Suppress similar topics more often?",
        operation: {
          type: "add-soft-suppression",
          value: slot.discovery.title,
        },
        evidence: { feedbackId: feedback.id },
        proposedAt: now,
        resolvedAt: null,
      };
      this.#store.savePreferenceProposal(proposal);
    }

    return { feedback, proposal };
  }

  preferenceProposals(
    status?: PreferenceProposal["status"],
  ): PreferenceProposal[] {
    return this.#store.listPreferenceProposals(status);
  }

  async confirmPreferenceProposal(id: string): Promise<PreferenceProposal> {
    const proposal = this.#requirePendingProposal(id);
    if (this.#interestProfile === null) {
      throw new Error("No human-owned Interest Profile updater is configured.");
    }
    await this.#interestProfile.apply(proposal.operation);
    const resolvedAt = this.#clock.now().toISOString();
    this.#store.resolvePreferenceProposal(id, "confirmed", resolvedAt);
    return { ...proposal, status: "confirmed", resolvedAt };
  }

  rejectPreferenceProposal(id: string): PreferenceProposal {
    const proposal = this.#requirePendingProposal(id);
    const resolvedAt = this.#clock.now().toISOString();
    this.#store.resolvePreferenceProposal(id, "rejected", resolvedAt);
    return { ...proposal, status: "rejected", resolvedAt };
  }

  #requirePendingProposal(id: string): PreferenceProposal {
    const proposal = this.#store.findPreferenceProposal(id);
    if (proposal === null) {
      throw new Error(`Preference Proposal ${id} does not exist.`);
    }
    if (proposal.status !== "pending") {
      throw new Error(
        `Preference Proposal ${id} is already ${proposal.status}.`,
      );
    }
    return proposal;
  }

  mvpEvaluationReview(): MvpEvaluationReview {
    const editions = this.#store.listEditions();
    const firstEditionAt = editions[0]?.generatedAt ?? null;
    const eligibleAt =
      firstEditionAt === null ? null : oneMonthAfter(firstEditionAt).toISOString();
    const discoveries = new Map<string, MvpEvaluationDiscovery>();
    for (const edition of editions) {
      for (const slot of edition.slots) {
        if (slot.status === "filled" && !discoveries.has(slot.discovery.id)) {
          discoveries.set(slot.discovery.id, {
            id: slot.discovery.id,
            title: slot.discovery.title,
            url: slot.discovery.recommendedMaterial.url,
            editionLocalDate: edition.localDate,
            slot: slot.role,
          });
        }
      }
    }
    return {
      ready:
        editions.length >= 20 &&
        eligibleAt !== null &&
        this.#clock.now().getTime() >= Date.parse(eligibleAt),
      generatedEditions: editions.length,
      firstEditionAt,
      eligibleAt,
      discoveries: [...discoveries.values()],
    };
  }

  recordMvpEvaluation(input: {
    worthwhileDiscoveryIds: string[];
    wantsToContinue: boolean;
  }): MvpEvaluation {
    if (this.#store.findMvpEvaluation() !== null) {
      throw new Error("The one-time MVP evaluation has already been recorded.");
    }
    const review = this.mvpEvaluationReview();
    if (!review.ready) {
      throw new Error(
        "The MVP evaluation requires one month of use and at least 20 generated editions.",
      );
    }
    const knownDiscoveryIds = new Set(review.discoveries.map((item) => item.id));
    const worthwhileDiscoveryIds = [...new Set(input.worthwhileDiscoveryIds)];
    const unknownId = worthwhileDiscoveryIds.find(
      (id) => !knownDiscoveryIds.has(id),
    );
    if (unknownId !== undefined) {
      throw new Error(`Discovery ${unknownId} was not exposed during the MVP trial.`);
    }
    const evaluation: MvpEvaluation = {
      evaluatedAt: this.#clock.now().toISOString(),
      worthwhileDiscoveryIds,
      worthwhileDiscoveries: worthwhileDiscoveryIds.length,
      wantsToContinue: input.wantsToContinue,
      succeeded:
        worthwhileDiscoveryIds.length >= 5 && input.wantsToContinue,
    };
    this.#store.saveMvpEvaluation(evaluation);
    return evaluation;
  }

  async collect(options?: { syncRemote?: boolean }): Promise<{
    collectedCount: number;
    remoteExposuresSynced: number;
  }> {
    const now = this.#clock.now();
    let collectedCount = 0;
    if (this.#collector && this.#configuration) {
      const enabledSources = this.#configuration.sources.filter((s) => s.enabled);
      const materials = await this.#collector.collect(enabledSources);
      
      const tierMap = this.#classifier
        ? await this.#classifier.classifyMaterials(materials)
        : new Map<string, DurabilityTier>();

      const poolItems: CandidatePoolItem[] = materials.map((m) => ({
        fingerprint: m.fingerprint,
        sourceId: m.source.id,
        sourceName: m.source.name,
        title: m.title,
        url: m.url,
        author: m.author,
        publishedAt: m.publishedAt,
        fetchedAt: now.toISOString(),
        summary: m.summary,
        content: m.content,
        estimatedMinutes: m.estimatedMinutes,
        format: m.format,
        durabilityTier: tierMap.get(m.fingerprint) ?? "emerging",
        provenance: m.provenance,
        referencedUrls: m.referencedUrls,
        isExposed: false,
        exposedAt: null,
      }));
      this.#store.savePoolMaterials(poolItems);
      collectedCount = poolItems.length;
    }

    let remoteExposuresSynced = 0;
    if (this.#rssPublisher && options?.syncRemote !== false) {
      const remote = await this.#rssPublisher.syncRemoteExposures();
      if (remote.length > 0) {
        this.#store.markPoolMaterialsExposed(
          remote.map((r) => r.fingerprint),
          now.toISOString(),
        );
        remoteExposuresSynced = remote.length;
      }
    }

    if (this.#rssPublisher) {
      await this.publishFeeds();
    }

    return { collectedCount, remoteExposuresSynced };
  }

  async pullCurated(options?: {
    count?: number | undefined;
    direction?: string | undefined;
    durabilityTier?: DurabilityTier | undefined;
  }): Promise<CuratedEncounter> {
    const now = this.#clock.now();
    const count = options?.count ?? 3;
    const direction = options?.direction;
    const durabilityTier = options?.durabilityTier;

    if (this.#rssPublisher) {
      const remote = await this.#rssPublisher.syncRemoteExposures();
      if (remote.length > 0) {
        this.#store.markPoolMaterialsExposed(
          remote.map((r) => r.fingerprint),
          now.toISOString(),
        );
      }
    }

    const unexposed = this.#store.listUnexposedPoolMaterials(undefined, durabilityTier);
    let encounter: CuratedEncounter;
    if (this.#pullEditor) {
      encounter = await this.#pullEditor.selectCuratedEncounter({
        poolMaterials: unexposed,
        request: { count, direction, durabilityTier },
        now,
      });
    } else {
      const sample = unexposed.slice(0, count);
      const discoveries: SelectedDiscovery[] = sample.map((item) => ({
        id: item.fingerprint.slice(0, 16),
        subjectKey: item.sourceId,
        subjectTerms: [item.sourceName],
        title: item.title,
        summary: item.summary,
        slotReason: "Selected from candidate pool",
        evidenceStatus: "Source verified",
        recommendedMaterial: {
          id: item.fingerprint,
          fingerprint: item.fingerprint,
          title: item.title,
          author: item.author ?? "Unknown",
          source: item.sourceName,
          format: item.format,
          url: item.url,
          meaningfulEntryMinutes: Math.min(item.estimatedMinutes, 10),
          fullLengthMinutes: item.estimatedMinutes,
          provenance: item.provenance,
        },
        alternativeMaterials: [],
      }));
      encounter = {
        id: randomUUID(),
        pulledAt: now.toISOString(),
        direction: direction ?? null,
        count: discoveries.length,
        discoveries,
        trace: {
          candidates: sample.map((s) => ({
            fingerprint: s.fingerprint,
            title: s.title,
          })),
          decisions: ["Fallback selection without online AI editor"],
          provider: {
            name: "fallback",
            model: "none",
            promptVersion: "1",
            schemaVersion: "1",
          },
        },
      };
    }

    this.#store.saveCuratedEncounter(encounter);
    const exposedFingerprints = encounter.discoveries.flatMap((d) => [
      d.recommendedMaterial.fingerprint,
      ...d.alternativeMaterials.map((m) => m.fingerprint),
    ]);
    this.#store.markPoolMaterialsExposed(exposedFingerprints, now.toISOString());

    if (this.#rssPublisher) {
      await this.publishFeeds();
    }

    return encounter;
  }

  browsePool(options?: {
    sourceId?: string | undefined;
    durabilityTier?: DurabilityTier | undefined;
  } | string): CandidatePoolItem[] {
    if (typeof options === "string") {
      return this.#store.listUnexposedPoolMaterials(options);
    }
    return this.#store.listUnexposedPoolMaterials(
      options?.sourceId,
      options?.durabilityTier,
    );
  }

  getPoolSummary(): CandidatePoolSourceSummary[] {
    return this.#store.listPoolSourcesSummary();
  }

  async reclassifyPool(options?: {
    forceAll?: boolean;
  }): Promise<{ reclassifiedCount: number }> {
    const unexposed = this.#store.listUnexposedPoolMaterials();
    if (unexposed.length === 0) {
      return { reclassifiedCount: 0 };
    }

    const tierMap = this.#classifier
      ? await this.#classifier.classifyMaterials(unexposed)
      : new Map<string, DurabilityTier>();

    for (const item of unexposed) {
      const tier = tierMap.get(item.fingerprint);
      if (tier) {
        this.#store.updateMaterialDurabilityTier(item.fingerprint, tier);
      }
    }

    if (this.#rssPublisher) {
      await this.publishFeeds();
    }

    return { reclassifiedCount: unexposed.length };
  }

  async markPoolItemRead(fingerprint: string): Promise<void> {
    const now = this.#clock.now();
    this.#store.markPoolMaterialsExposed([fingerprint], now.toISOString());
    if (this.#rssPublisher) {
      await this.publishFeeds();
    }
  }

  async markSourceRead(sourceId: string): Promise<void> {
    const now = this.#clock.now();
    this.#store.markSourceExposed(sourceId, now.toISOString());
    if (this.#rssPublisher) {
      await this.publishFeeds();
    }
  }

  async publishFeeds(): Promise<{ curatedXmlPath: string; poolXmlPath: string } | null> {
    if (!this.#rssPublisher) return null;
    const curatedEncounters = this.#store.listCuratedEncounters();
    const poolMaterials = this.#store.listUnexposedPoolMaterials();
    return this.#rssPublisher.publish({ curatedEncounters, poolMaterials });
  }
}

function oneMonthAfter(value: string): Date {
  const date = new Date(value);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown generation failure";
}

function assertValidDraft(
  draft: DailyEditionDraft,
  localDate: string,
  priorExposures: import("../domain/contracts.js").ExposureEvidence[],
): void {
  if (draft.localDate !== localDate) {
    throw new Error(
      `Editor returned an edition for ${draft.localDate}; expected ${localDate}.`,
    );
  }

  if (
    draft.slots.length !== selectionSlotRoles.length ||
    !selectionSlotRoles.every(
      (role, index) => draft.slots[index]?.role === role,
    )
  ) {
    throw new Error(
      "A Daily Edition must contain Important, Personally Interesting, and Wildcard slots in order.",
    );
  }

  const discoveryIds = draft.slots.flatMap((slot) =>
    slot.status === "filled" ? [slot.discovery.id] : [],
  );
  if (new Set(discoveryIds).size !== discoveryIds.length) {
    throw new Error("A Discovery cannot occupy more than one Selection Slot.");
  }

  const excludedDiscoveryIds = new Set(priorExposures.map((item) => item.discoveryId));
  const repeatedDiscoveryId = discoveryIds.find((id) => excludedDiscoveryIds.has(id));
  if (repeatedDiscoveryId !== undefined) {
    throw new Error(
      `Discovery ${repeatedDiscoveryId} was previously exposed and is not eligible.`,
    );
  }
  const priorFingerprints = new Set(
    priorExposures.flatMap((item) => item.materialFingerprints),
  );
  for (const slot of draft.slots) {
    if (slot.status === "unavailable") continue;
    const fingerprints = [
      slot.discovery.recommendedMaterial.fingerprint,
      ...slot.discovery.alternativeMaterials.map((material) => material.fingerprint),
    ];
    if (fingerprints.some((fingerprint) => priorFingerprints.has(fingerprint))) {
      throw new Error(
        `Discovery ${slot.discovery.id} reuses Material from a prior Exposure.`,
      );
    }
    const repeatedSubject = priorExposures.find((exposure) =>
      slot.discovery.subjectKey === exposure.subjectKey ||
      termsLikelySameSubject(slot.discovery.subjectTerms, exposure.subjectTerms),
    );
    if (repeatedSubject !== undefined) {
      throw new Error(
        `Discovery ${slot.discovery.id} is too similar to prior Exposure ${repeatedSubject.discoveryId}.`,
      );
    }
  }
}

function termsLikelySameSubject(left: string[], right: string[]): boolean {
  const leftTerms = new Set(left);
  const rightTerms = new Set(right);
  if (leftTerms.size === 0 || rightTerms.size === 0) return false;
  const shared = [...leftTerms].filter((term) => rightTerms.has(term)).length;
  return shared / Math.min(leftTerms.size, rightTerms.size) >= 0.6;
}

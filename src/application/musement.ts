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
} from "../domain/contracts.js";

export interface MusementDependencies {
  store: EditionStore;
  editor: EditionEditor;
  clock: Clock;
  timezone: string;
  interestProfile?: InterestProfileUpdater;
}

export class Musement {
  readonly #store: EditionStore;
  readonly #editor: EditionEditor;
  readonly #clock: Clock;
  readonly #timezone: string;
  readonly #interestProfile: InterestProfileUpdater | null;

  constructor(dependencies: MusementDependencies) {
    this.#store = dependencies.store;
    this.#editor = dependencies.editor;
    this.#clock = dependencies.clock;
    this.#timezone = dependencies.timezone;
    this.#interestProfile = dependencies.interestProfile ?? null;
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
        feedbackEvidence: this.#store.listFeedbackEvidence(),
      });
      assertValidDraft(draft, localDate, priorExposures);

      const edition: DailyEdition = {
        ...draft,
        id: randomUUID(),
        generatedAt: now.toISOString(),
        status: draft.slots.some((slot) => slot.status === "unavailable")
          ? "degraded"
          : "complete",
      };

      const canonicalEdition = this.#store.saveCanonicalEdition(edition);
      this.#store.finishGenerationAttempt(attempt.id, {
        status: "succeeded",
        finishedAt: this.#clock.now().toISOString(),
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
}

function oneMonthAfter(value: string): Date {
  const date = new Date(value);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown generation failure";
}

function localDateInTimezone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
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

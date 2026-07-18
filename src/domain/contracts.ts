export const selectionSlotRoles = [
  "important",
  "personally-interesting",
  "wildcard",
] as const;

export type SelectionSlotRole = (typeof selectionSlotRoles)[number];

export type MaterialFormat =
  | "article"
  | "paper"
  | "lecture"
  | "podcast"
  | "video"
  | "other";

export interface RecommendedMaterial {
  id: string;
  fingerprint: string;
  title: string;
  author: string;
  source: string;
  format: MaterialFormat;
  url: string;
  meaningfulEntryMinutes: number;
  fullLengthMinutes: number | null;
  provenance: string[];
  meaningfulEntry?: string;
  uncertainty?: string;
  accessRequirement?: string;
}

export type AlternativeMaterial = Pick<
  RecommendedMaterial,
  "id" | "fingerprint" | "title" | "author" | "source" | "format" | "url" | "provenance"
>;

export interface CollectedMaterial {
  id: string;
  fingerprint: string;
  title: string;
  url: string;
  author: string | null;
  publishedAt: string | null;
  format: MaterialFormat;
  summary: string;
  content: string;
  estimatedMinutes: number;
  source: {
    id: string;
    name: string;
  };
  provenance: string[];
  referencedUrls: string[];
}

export interface SelectedDiscovery {
  id: string;
  subjectTerms: string[];
  title: string;
  summary: string;
  slotReason: string;
  evidenceStatus: string;
  recommendedMaterial: RecommendedMaterial;
  alternativeMaterials: AlternativeMaterial[];
}

export interface FilledSelectionSlot {
  role: SelectionSlotRole;
  status: "filled";
  discovery: SelectedDiscovery;
}

export interface UnavailableSelectionSlot {
  role: SelectionSlotRole;
  status: "unavailable";
  reason: string;
}

export type SelectionSlot = FilledSelectionSlot | UnavailableSelectionSlot;

export interface ProviderTrace {
  name: string;
  model: string;
  promptVersion: string;
  schemaVersion: string;
}

export interface SelectionTrace {
  candidates: unknown[];
  assessments?: unknown[];
  shortlists?: unknown[];
  decisions: string[];
  provider: ProviderTrace;
}

export interface DailyEditionDraft {
  localDate: string;
  slots: SelectionSlot[];
  trace: SelectionTrace;
}

export interface DailyEdition extends DailyEditionDraft {
  id: string;
  generatedAt: string;
  status: "complete" | "degraded";
}

export interface GenerationAttempt {
  id: string;
  localDate: string;
  status: "pending" | "failed" | "succeeded";
  startedAt: string;
  finishedAt: string | null;
  failureReason: string | null;
}

export interface DiscoverySelectedEvent {
  event_id: string;
  event_type: "DiscoverySelected";
  event_version: 1;
  position: number;
  occurred_at: string;
  data: {
    edition: {
      id: string;
      local_date: string;
    };
    selection_slot: SelectionSlotRole;
    discovery: {
      id: string;
      title: string;
      summary: string;
      evidence_status: string;
    };
    recommended_material: {
      id: string;
      title: string;
      author: string;
      source: string;
      format: MaterialFormat;
      url: string;
      provenance: string[];
      meaningful_entry?: string;
      meaningful_entry_minutes?: number;
      full_length_minutes?: number | null;
    };
  };
}

export type UnpositionedDiscoverySelectedEvent = Omit<
  DiscoverySelectedEvent,
  "position"
>;

export type FeedbackKind = "good-pick" | "not-useful" | "already-knew";
export type NotUsefulReason =
  | "topic"
  | "source"
  | "depth"
  | "repetition"
  | "timing"
  | "other";

export interface QuickFeedback {
  id: string;
  editionId: string;
  discoveryId: string;
  localDate: string;
  role: SelectionSlotRole;
  kind: FeedbackKind;
  reason: NotUsefulReason | null;
  recordedAt: string;
}

export type PreferenceOperation = {
  type: "add-soft-suppression";
  value: string;
};

export interface PreferenceProposal {
  id: string;
  status: "pending" | "confirmed" | "rejected";
  explanation: string;
  operation: PreferenceOperation;
  evidence: { feedbackId: string };
  proposedAt: string;
  resolvedAt: string | null;
}

export interface InterestProfileUpdater {
  apply(operation: PreferenceOperation): Promise<void>;
}

export interface MvpEvaluationDiscovery {
  id: string;
  title: string;
  url: string;
  editionLocalDate: string;
  slot: SelectionSlotRole;
}

export interface MvpEvaluationReview {
  ready: boolean;
  generatedEditions: number;
  firstEditionAt: string | null;
  eligibleAt: string | null;
  discoveries: MvpEvaluationDiscovery[];
}

export interface MvpEvaluation {
  evaluatedAt: string;
  worthwhileDiscoveryIds: string[];
  worthwhileDiscoveries: number;
  wantsToContinue: boolean;
  succeeded: boolean;
}

export interface GenerateEditionRequest {
  localDate: string;
  excludedDiscoveryIds: string[];
  priorExposures: ExposureEvidence[];
  feedbackEvidence: FeedbackEvidence[];
}

export interface ExposureEvidence {
  discoveryId: string;
  title: string;
  materialFingerprints: string[];
  subjectTerms: string[];
}

export interface FeedbackEvidence {
  discoveryId: string;
  title: string;
  role: SelectionSlotRole;
  kind: FeedbackKind;
  reason: NotUsefulReason | null;
}

export interface EditionEditor {
  generate(request: GenerateEditionRequest): Promise<DailyEditionDraft>;
}

export interface EditionStore {
  findEdition(localDate: string): DailyEdition | null;
  listExposedDiscoveryIds(): string[];
  listExposureEvidence(): ExposureEvidence[];
  listFeedbackEvidence(): FeedbackEvidence[];
  saveCanonicalEdition(edition: DailyEdition): DailyEdition;
  beginGenerationAttempt(attempt: GenerationAttempt): void;
  finishGenerationAttempt(
    attemptId: string,
    result:
      | { status: "succeeded"; finishedAt: string }
      | { status: "failed"; finishedAt: string; failureReason: string },
  ): void;
  listGenerationAttempts(localDate: string): GenerationAttempt[];
  appendHandoffEvent(
    event: UnpositionedDiscoverySelectedEvent,
  ): DiscoverySelectedEvent;
  readHandoffEvents(afterPosition: number, limit: number): DiscoverySelectedEvent[];
  recordFeedback(feedback: QuickFeedback): void;
  savePreferenceProposal(proposal: PreferenceProposal): void;
  findPreferenceProposal(id: string): PreferenceProposal | null;
  listPreferenceProposals(
    status?: PreferenceProposal["status"],
  ): PreferenceProposal[];
  resolvePreferenceProposal(
    id: string,
    status: "confirmed" | "rejected",
    resolvedAt: string,
  ): void;
  listEditions(): DailyEdition[];
  findMvpEvaluation(): MvpEvaluation | null;
  saveMvpEvaluation(evaluation: MvpEvaluation): void;
  close(): void;
}

export interface Clock {
  now(): Date;
}

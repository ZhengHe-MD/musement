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
  subjectKey: string;
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
  degradationCause?: "quality-floor" | "source-poverty";
  candidatesEvaluated?: number;
}

export type SelectionSlot = FilledSelectionSlot | UnavailableSelectionSlot;

export interface ProviderTrace {
  name: string;
  model: string;
  promptVersion: string;
  schemaVersion: string;
  tokenUsage?: GenerationTokenUsage;
}

export interface GenerationTokenUsage {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

export interface SelectionTrace {
  candidates: unknown[];
  /** Fingerprints of the candidates actually placed before the editor. */
  enlistedFingerprints?: string[];
  assessments?: unknown[];
  shortlists?: unknown[];
  decisions: string[];
  provider: ProviderTrace;
}

export interface DailyEditionDraft {
  localDate: string;
  slots: SelectionSlot[];
  trace: SelectionTrace;
  generationMetrics?: GenerationMetrics;
}

export interface DailyEdition extends DailyEditionDraft {
  id: string;
  generatedAt: string;
  status: "complete" | "degraded";
  editionQuality?: "normal" | "low-signal-day" | "source-gap";
}

export interface GenerationMetrics {
  collectionDurationMs: number;
  candidatesCollected: number;
  candidatesEligible: number;
  candidatesEnlisted: number;
  aiGenerationDurationMs: number;
  broadened: boolean;
  broadeningDurationMs?: number;
}

export interface GenerationAttempt {
  id: string;
  localDate: string;
  status: "pending" | "failed" | "succeeded";
  startedAt: string;
  finishedAt: string | null;
  failureReason: string | null;
  metrics?: GenerationMetrics;
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
  priorEnlistments: EnlistmentEvidence[];
  feedbackEvidence: FeedbackEvidence[];
}

/**
 * A Material that has already been placed before the editor as a candidate,
 * whether or not it was selected. Enlistment bounds one edition's candidate
 * sample; it is not Exposure and never removes a Discovery from eligibility.
 */
export interface EnlistmentEvidence {
  fingerprint: string;
  lastEnlistedAt: string;
}

export interface ExposureEvidence {
  discoveryId: string;
  subjectKey: string;
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

export interface SourceProbeResult {
  sourceId: string;
  sourceName: string;
  status: "ok" | "failed";
  itemCount: number;
  durationMs: number;
  error?: string;
}

export interface CandidateSnapshot {
  fingerprint: string;
  sourceId: string;
  sourceName: string;
  title: string;
  url: string;
  author: string | null;
  publishedAt: string | null;
  fetchedAt: string;
  estimatedMinutes: number;
  contentLength: number;
  eligible: boolean;
  ruleOutcomes: string[];
}

export interface EditionEditor {
  generate(request: GenerateEditionRequest): Promise<DailyEditionDraft>;
}

export const durabilityTiers = [
  "evergreen",
  "emerging",
  "horizon",
] as const;

export type DurabilityTier = (typeof durabilityTiers)[number];

export interface CandidatePoolItem {
  fingerprint: string;
  sourceId: string;
  sourceName: string;
  title: string;
  url: string;
  author: string | null;
  publishedAt: string | null;
  fetchedAt: string;
  summary: string;
  content: string;
  estimatedMinutes: number;
  format: MaterialFormat;
  durabilityTier: DurabilityTier;
  provenance: string[];
  referencedUrls: string[];
  isExposed: boolean;
  exposedAt: string | null;
}

export interface CandidatePoolSourceSummary {
  sourceId: string;
  sourceName: string;
  totalItems: number;
  unexposedItems: number;
}

export interface CuratedPullRequest {
  count: number;
  direction?: string | undefined;
  durabilityTier?: DurabilityTier | undefined;
  excludedDiscoveryIds?: string[] | undefined;
}

export interface CuratedEncounter {
  id: string;
  pulledAt: string;
  direction: string | null;
  count: number;
  discoveries: SelectedDiscovery[];
  trace: SelectionTrace;
}

export interface EditionStore {
  findEdition(localDate: string): DailyEdition | null;
  listExposedDiscoveryIds(): string[];
  listExposureEvidence(): ExposureEvidence[];
  listEnlistmentEvidence(): EnlistmentEvidence[];
  recordEnlistments(fingerprints: string[], enlistedAt: string): void;
  listFeedbackEvidence(): FeedbackEvidence[];
  saveCanonicalEdition(edition: DailyEdition): DailyEdition;
  saveCandidateSnapshot(localDate: string, candidates: CandidateSnapshot[]): void;
  loadCandidateSnapshot(localDate: string): CandidateSnapshot[];
  savePoolMaterials(materials: CandidatePoolItem[]): void;
  listUnexposedPoolMaterials(
    sourceId?: string,
    durabilityTier?: DurabilityTier,
  ): CandidatePoolItem[];
  listAllPoolMaterials(
    sourceId?: string,
    durabilityTier?: DurabilityTier,
  ): CandidatePoolItem[];
  searchUnexposedPoolMaterials(
    keywords: string[],
    options?: {
      limit?: number;
      durabilityTier?: DurabilityTier;
      sourceId?: string;
    },
  ): CandidatePoolItem[];
  updateMaterialDurabilityTier(
    fingerprint: string,
    durabilityTier: DurabilityTier,
  ): void;
  markPoolMaterialsExposed(fingerprints: string[], exposedAt: string): void;
  markSourceExposed(sourceId: string, exposedAt: string): void;
  listPoolSourcesSummary(): CandidatePoolSourceSummary[];
  saveCuratedEncounter(encounter: CuratedEncounter): void;
  listCuratedEncounters(): CuratedEncounter[];
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


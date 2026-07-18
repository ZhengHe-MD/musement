import { DatabaseSync } from "node:sqlite";
import { chmodSync } from "node:fs";

import type {
  DailyEdition,
  DiscoverySelectedEvent,
  EditionStore,
  ExposureEvidence,
  FeedbackEvidence,
  GenerationAttempt,
  MvpEvaluation,
  PreferenceProposal,
  QuickFeedback,
  UnpositionedDiscoverySelectedEvent,
} from "../domain/contracts.js";

interface EditionRow {
  payload: string;
}

interface GenerationAttemptRow {
  attempt_id: string;
  local_date: string;
  status: GenerationAttempt["status"];
  started_at: string;
  finished_at: string | null;
  failure_reason: string | null;
}

interface HandoffEventRow {
  position: number;
  event_id: string;
  event_type: "DiscoverySelected";
  event_version: 1;
  occurred_at: string;
  data: string;
}

interface PreferenceProposalRow {
  payload: string;
}

export class SqliteMusementStore implements EditionStore {
  readonly #database: DatabaseSync;
  #closed = false;

  constructor(path: string) {
    this.#database = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.#database.exec("PRAGMA journal_mode = WAL;");
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS daily_editions (
        local_date TEXT PRIMARY KEY,
        edition_id TEXT NOT NULL UNIQUE,
        payload TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS generation_attempts (
        attempt_id TEXT PRIMARY KEY,
        local_date TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'failed', 'succeeded')),
        started_at TEXT NOT NULL,
        finished_at TEXT,
        failure_reason TEXT
      ) STRICT;

      CREATE INDEX IF NOT EXISTS generation_attempts_by_date
        ON generation_attempts (local_date, started_at);

      CREATE TABLE IF NOT EXISTS exposures (
        discovery_id TEXT PRIMARY KEY,
        local_date TEXT NOT NULL,
        edition_id TEXT NOT NULL,
        FOREIGN KEY (local_date) REFERENCES daily_editions (local_date)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS handoff_events (
        position INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        event_type TEXT NOT NULL,
        event_version INTEGER NOT NULL,
        occurred_at TEXT NOT NULL,
        data TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS feedback (
        feedback_id TEXT PRIMARY KEY,
        edition_id TEXT NOT NULL,
        discovery_id TEXT NOT NULL,
        local_date TEXT NOT NULL,
        role TEXT NOT NULL,
        kind TEXT NOT NULL,
        reason TEXT,
        recorded_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS preference_proposals (
        proposal_id TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'rejected')),
        proposed_at TEXT NOT NULL,
        payload TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS mvp_evaluation (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        payload TEXT NOT NULL
      ) STRICT;
    `);
  }

  findEdition(localDate: string): DailyEdition | null {
    const row = this.#database
      .prepare("SELECT payload FROM daily_editions WHERE local_date = ?")
      .get(localDate) as EditionRow | undefined;
    return row === undefined ? null : parseEdition(row.payload);
  }

  listExposedDiscoveryIds(): string[] {
    const rows = this.#database
      .prepare("SELECT discovery_id FROM exposures ORDER BY discovery_id")
      .all() as unknown as Array<{ discovery_id: string }>;
    return rows.map((row) => row.discovery_id);
  }

  listExposureEvidence(): ExposureEvidence[] {
    return this.listEditions().flatMap((edition) =>
      edition.slots.flatMap((slot) =>
        slot.status === "unavailable"
          ? []
          : [{
              discoveryId: slot.discovery.id,
              subjectKey: slot.discovery.subjectKey,
              title: slot.discovery.title,
              subjectTerms: slot.discovery.subjectTerms,
              materialFingerprints: [
                slot.discovery.recommendedMaterial.fingerprint,
                ...slot.discovery.alternativeMaterials.map(
                  (material) => material.fingerprint,
                ),
              ],
            }],
      ),
    );
  }

  listFeedbackEvidence(): FeedbackEvidence[] {
    const editionsById = new Map(
      this.listEditions().map((edition) => [edition.id, edition]),
    );
    const rows = this.#database.prepare(
      `SELECT edition_id, discovery_id, role, kind, reason
       FROM feedback ORDER BY recorded_at, rowid`,
    ).all() as unknown as Array<{
      edition_id: string;
      discovery_id: string;
      role: FeedbackEvidence["role"];
      kind: FeedbackEvidence["kind"];
      reason: FeedbackEvidence["reason"];
    }>;
    return rows.flatMap((row) => {
      const edition = editionsById.get(row.edition_id);
      const slot = edition?.slots.find(
        (candidate) =>
          candidate.status === "filled" &&
          candidate.discovery.id === row.discovery_id,
      );
      return slot?.status === "filled"
        ? [{
            discoveryId: row.discovery_id,
            title: slot.discovery.title,
            role: row.role,
            kind: row.kind,
            reason: row.reason,
          }]
        : [];
    });
  }

  saveCanonicalEdition(edition: DailyEdition): DailyEdition {
    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      this.#database
        .prepare(
          `INSERT OR IGNORE INTO daily_editions (local_date, edition_id, payload)
           VALUES (?, ?, ?)`,
        )
        .run(edition.localDate, edition.id, JSON.stringify(edition));

      const canonicalEdition = this.findEdition(edition.localDate);
      if (canonicalEdition === null) {
        throw new Error(`Failed to persist Daily Edition for ${edition.localDate}.`);
      }

      if (canonicalEdition.id === edition.id) {
        const insertExposure = this.#database.prepare(
          `INSERT INTO exposures (discovery_id, local_date, edition_id)
           VALUES (?, ?, ?)`,
        );
        for (const slot of edition.slots) {
          if (slot.status === "filled") {
            insertExposure.run(
              slot.discovery.id,
              edition.localDate,
              edition.id,
            );
          }
        }
      }

      this.#database.exec("COMMIT;");
      return canonicalEdition;
    } catch (error) {
      this.#database.exec("ROLLBACK;");
      throw error;
    }
  }

  beginGenerationAttempt(attempt: GenerationAttempt): void {
    this.#database
      .prepare(
        `INSERT INTO generation_attempts (
          attempt_id, local_date, status, started_at, finished_at, failure_reason
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        attempt.id,
        attempt.localDate,
        attempt.status,
        attempt.startedAt,
        attempt.finishedAt,
        attempt.failureReason,
      );
  }

  finishGenerationAttempt(
    attemptId: string,
    result:
      | { status: "succeeded"; finishedAt: string }
      | { status: "failed"; finishedAt: string; failureReason: string },
  ): void {
    const failureReason =
      result.status === "failed" ? result.failureReason : null;
    this.#database
      .prepare(
        `UPDATE generation_attempts
         SET status = ?, finished_at = ?, failure_reason = ?
         WHERE attempt_id = ?`,
      )
      .run(result.status, result.finishedAt, failureReason, attemptId);
  }

  listGenerationAttempts(localDate: string): GenerationAttempt[] {
    const rows = this.#database
      .prepare(
        `SELECT attempt_id, local_date, status, started_at, finished_at, failure_reason
         FROM generation_attempts
         WHERE local_date = ?
         ORDER BY rowid`,
      )
      .all(localDate) as unknown as GenerationAttemptRow[];

    return rows.map((row) => ({
      id: row.attempt_id,
      localDate: row.local_date,
      status: row.status,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      failureReason: row.failure_reason,
    }));
  }

  appendHandoffEvent(
    event: UnpositionedDiscoverySelectedEvent,
  ): DiscoverySelectedEvent {
    const result = this.#database
      .prepare(
        `INSERT INTO handoff_events (
          event_id, event_type, event_version, occurred_at, data
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        event.event_id,
        event.event_type,
        event.event_version,
        event.occurred_at,
        JSON.stringify(event.data),
      );

    return {
      ...event,
      position: Number(result.lastInsertRowid),
    };
  }

  readHandoffEvents(
    afterPosition: number,
    limit: number,
  ): DiscoverySelectedEvent[] {
    const rows = this.#database
      .prepare(
        `SELECT position, event_id, event_type, event_version, occurred_at, data
         FROM handoff_events
         WHERE position > ?
         ORDER BY position
         LIMIT ?`,
      )
      .all(afterPosition, limit) as unknown as HandoffEventRow[];

    return rows.map((row) => ({
      event_id: row.event_id,
      event_type: row.event_type,
      event_version: row.event_version,
      position: row.position,
      occurred_at: row.occurred_at,
      data: JSON.parse(row.data) as DiscoverySelectedEvent["data"],
    }));
  }

  recordFeedback(feedback: QuickFeedback): void {
    this.#database
      .prepare(
        `INSERT INTO feedback (
          feedback_id, edition_id, discovery_id, local_date, role, kind, reason, recorded_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        feedback.id,
        feedback.editionId,
        feedback.discoveryId,
        feedback.localDate,
        feedback.role,
        feedback.kind,
        feedback.reason,
        feedback.recordedAt,
      );
  }

  savePreferenceProposal(proposal: PreferenceProposal): void {
    this.#database
      .prepare(
        `INSERT INTO preference_proposals (proposal_id, status, proposed_at, payload)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        proposal.id,
        proposal.status,
        proposal.proposedAt,
        JSON.stringify(proposal),
      );
  }

  findPreferenceProposal(id: string): PreferenceProposal | null {
    const row = this.#database
      .prepare("SELECT payload FROM preference_proposals WHERE proposal_id = ?")
      .get(id) as PreferenceProposalRow | undefined;
    return row === undefined
      ? null
      : (JSON.parse(row.payload) as PreferenceProposal);
  }

  listPreferenceProposals(
    status?: PreferenceProposal["status"],
  ): PreferenceProposal[] {
    const rows = (status === undefined
      ? this.#database
          .prepare(
            "SELECT payload FROM preference_proposals ORDER BY proposed_at, rowid",
          )
          .all()
      : this.#database
          .prepare(
            `SELECT payload FROM preference_proposals
             WHERE status = ? ORDER BY proposed_at, rowid`,
          )
          .all(status)) as unknown as PreferenceProposalRow[];
    return rows.map(
      (row) => JSON.parse(row.payload) as PreferenceProposal,
    );
  }

  resolvePreferenceProposal(
    id: string,
    status: "confirmed" | "rejected",
    resolvedAt: string,
  ): void {
    const proposal = this.findPreferenceProposal(id);
    if (proposal === null) {
      throw new Error(`Preference Proposal ${id} does not exist.`);
    }
    const resolved: PreferenceProposal = { ...proposal, status, resolvedAt };
    this.#database
      .prepare(
        `UPDATE preference_proposals SET status = ?, payload = ?
         WHERE proposal_id = ? AND status = 'pending'`,
      )
      .run(status, JSON.stringify(resolved), id);
  }

  listEditions(): DailyEdition[] {
    const rows = this.#database
      .prepare("SELECT payload FROM daily_editions ORDER BY local_date")
      .all() as unknown as EditionRow[];
    return rows.map((row) => parseEdition(row.payload));
  }

  findMvpEvaluation(): MvpEvaluation | null {
    const row = this.#database
      .prepare("SELECT payload FROM mvp_evaluation WHERE singleton = 1")
      .get() as { payload: string } | undefined;
    return row === undefined ? null : (JSON.parse(row.payload) as MvpEvaluation);
  }

  saveMvpEvaluation(evaluation: MvpEvaluation): void {
    this.#database
      .prepare("INSERT INTO mvp_evaluation (singleton, payload) VALUES (1, ?)")
      .run(JSON.stringify(evaluation));
  }

  close(): void {
    if (this.#closed) return;
    this.#database.close();
    this.#closed = true;
  }
}

function parseEdition(payload: string): DailyEdition {
  return JSON.parse(payload) as DailyEdition;
}

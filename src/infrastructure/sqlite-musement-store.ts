import { DatabaseSync } from "node:sqlite";
import { chmodSync } from "node:fs";

import type {
  DailyEdition,
  DiscoverySelectedEvent,
  EditionStore,
  EnlistmentEvidence,
  ExposureEvidence,
  FeedbackEvidence,
  GenerationAttempt,
  MvpEvaluation,
  PreferenceProposal,
  QuickFeedback,
  UnpositionedDiscoverySelectedEvent,
  CandidateSnapshot,
  GenerationMetrics,
  CandidatePoolItem,
  CandidatePoolSourceSummary,
  CuratedEncounter,
  DurabilityTier,
} from "../domain/contracts.js";
import type { StoredTranscript } from "./youtube-transcript-connector.js";

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
  metrics_json: string | null;
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

interface VideoTranscriptRow {
  video_id: string;
  fetched_at: string;
  status: StoredTranscript["status"];
  language: string | null;
  duration_seconds: number | null;
  transcript: string;
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

      CREATE TABLE IF NOT EXISTS candidate_enlistments (
        fingerprint TEXT PRIMARY KEY,
        first_enlisted_at TEXT NOT NULL,
        last_enlisted_at TEXT NOT NULL,
        enlistment_count INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS video_transcripts (
        video_id TEXT PRIMARY KEY,
        fetched_at TEXT NOT NULL,
        status TEXT NOT NULL,
        language TEXT,
        duration_seconds INTEGER,
        transcript TEXT NOT NULL
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

      CREATE TABLE IF NOT EXISTS candidate_snapshots (
        local_date TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        source_id TEXT NOT NULL,
        source_name TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        author TEXT,
        published_at TEXT,
        fetched_at TEXT NOT NULL,
        estimated_minutes REAL NOT NULL,
        content_length INTEGER NOT NULL,
        eligible INTEGER NOT NULL,
        rule_outcomes TEXT NOT NULL,
        PRIMARY KEY (local_date, fingerprint)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS candidate_pool (
        fingerprint TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        source_name TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        author TEXT,
        published_at TEXT,
        fetched_at TEXT NOT NULL,
        summary TEXT NOT NULL,
        content TEXT NOT NULL,
        estimated_minutes REAL NOT NULL,
        format TEXT NOT NULL,
        durability_tier TEXT NOT NULL DEFAULT 'emerging' CHECK (durability_tier IN ('evergreen', 'emerging', 'horizon')),
        provenance_json TEXT NOT NULL,
        referenced_urls_json TEXT NOT NULL,
        is_exposed INTEGER NOT NULL DEFAULT 0,
        exposed_at TEXT
      ) STRICT;

      CREATE INDEX IF NOT EXISTS candidate_pool_unexposed
        ON candidate_pool (is_exposed, source_id, fetched_at);

      CREATE TABLE IF NOT EXISTS curated_encounters (
        id TEXT PRIMARY KEY,
        pulled_at TEXT NOT NULL,
        direction TEXT,
        count INTEGER NOT NULL,
        payload TEXT NOT NULL
      ) STRICT;
    `);

    try {
      this.#database.exec(
        "ALTER TABLE generation_attempts ADD COLUMN metrics_json TEXT;",
      );
    } catch {
      // Column may already exist
    }

    try {
      this.#database.exec(
        "ALTER TABLE candidate_pool ADD COLUMN durability_tier TEXT NOT NULL DEFAULT 'emerging' CHECK (durability_tier IN ('evergreen', 'emerging', 'horizon'));",
      );
    } catch {
      // Column may already exist
    }

    try {
      this.#database.exec(
        "CREATE INDEX IF NOT EXISTS candidate_pool_tier ON candidate_pool (is_exposed, durability_tier, published_at);",
      );
    } catch {
      // Index creation fallback
    }
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

  listEnlistmentEvidence(): EnlistmentEvidence[] {
    const rows = this.#database
      .prepare("SELECT fingerprint, last_enlisted_at FROM candidate_enlistments")
      .all() as unknown as Array<{ fingerprint: string; last_enlisted_at: string }>;
    return rows.map((row) => ({
      fingerprint: row.fingerprint,
      lastEnlistedAt: row.last_enlisted_at,
    }));
  }

  recordEnlistments(fingerprints: string[], enlistedAt: string): void {
    const statement = this.#database.prepare(
      `INSERT INTO candidate_enlistments
         (fingerprint, first_enlisted_at, last_enlisted_at, enlistment_count)
       VALUES (?, ?, ?, 1)
       ON CONFLICT (fingerprint) DO UPDATE SET
         last_enlisted_at = excluded.last_enlisted_at,
         enlistment_count = enlistment_count + 1`,
    );
    for (const fingerprint of fingerprints) {
      statement.run(fingerprint, enlistedAt, enlistedAt);
    }
  }

  findTranscript(videoId: string): StoredTranscript | null {
    const row = this.#database
      .prepare(
        `SELECT video_id, fetched_at, status, language, duration_seconds, transcript
           FROM video_transcripts WHERE video_id = ?`,
      )
      .get(videoId) as unknown as VideoTranscriptRow | undefined;
    if (row === undefined) {
      return null;
    }
    return {
      videoId: row.video_id,
      fetchedAt: row.fetched_at,
      status: row.status,
      language: row.language,
      durationSeconds: row.duration_seconds,
      transcript: row.transcript,
    };
  }

  saveTranscript(record: StoredTranscript): void {
    this.#database
      .prepare(
        `INSERT INTO video_transcripts
           (video_id, fetched_at, status, language, duration_seconds, transcript)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (video_id) DO UPDATE SET
           fetched_at = excluded.fetched_at,
           status = excluded.status,
           language = excluded.language,
           duration_seconds = excluded.duration_seconds,
           transcript = excluded.transcript`,
      )
      .run(
        record.videoId,
        record.fetchedAt,
        record.status,
        record.language,
        record.durationSeconds,
        record.transcript,
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
          attempt_id, local_date, status, started_at, finished_at, failure_reason, metrics_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        attempt.id,
        attempt.localDate,
        attempt.status,
        attempt.startedAt,
        attempt.finishedAt,
        attempt.failureReason,
        attempt.metrics ? JSON.stringify(attempt.metrics) : null,
      );
  }

  finishGenerationAttempt(
    attemptId: string,
    result:
      | { status: "succeeded"; finishedAt: string; metrics?: GenerationMetrics }
      | { status: "failed"; finishedAt: string; failureReason: string; metrics?: GenerationMetrics },
  ): void {
    const failureReason =
      result.status === "failed" ? result.failureReason : null;
    const metricsJson = result.metrics ? JSON.stringify(result.metrics) : null;
    this.#database
      .prepare(
        `UPDATE generation_attempts
         SET status = ?, finished_at = ?, failure_reason = ?, metrics_json = ?
         WHERE attempt_id = ?`,
      )
      .run(result.status, result.finishedAt, failureReason, metricsJson, attemptId);
  }

  listGenerationAttempts(localDate: string): GenerationAttempt[] {
    const rows = this.#database
      .prepare(
        `SELECT attempt_id, local_date, status, started_at, finished_at, failure_reason, metrics_json
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
      ...(row.metrics_json ? { metrics: JSON.parse(row.metrics_json) as GenerationMetrics } : {}),
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

  saveCandidateSnapshot(localDate: string, candidates: CandidateSnapshot[]): void {
    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      const statement = this.#database.prepare(
        `INSERT OR IGNORE INTO candidate_snapshots (
          local_date, fingerprint, source_id, source_name, title, url, author,
          published_at, fetched_at, estimated_minutes, content_length, eligible, rule_outcomes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const candidate of candidates) {
        statement.run(
          localDate,
          candidate.fingerprint,
          candidate.sourceId,
          candidate.sourceName,
          candidate.title,
          candidate.url,
          candidate.author ?? null,
          candidate.publishedAt ?? null,
          candidate.fetchedAt,
          candidate.estimatedMinutes,
          candidate.contentLength,
          candidate.eligible ? 1 : 0,
          JSON.stringify(candidate.ruleOutcomes)
        );
      }
      this.#database.exec("COMMIT;");
    } catch (error) {
      this.#database.exec("ROLLBACK;");
      throw error;
    }
  }

  loadCandidateSnapshot(localDate: string): CandidateSnapshot[] {
    const rows = this.#database
      .prepare(
        `SELECT fingerprint, source_id, source_name, title, url, author,
                published_at, fetched_at, estimated_minutes, content_length, eligible, rule_outcomes
         FROM candidate_snapshots
         WHERE local_date = ?
         ORDER BY rowid`
      )
      .all(localDate) as unknown as Array<{
        fingerprint: string;
        source_id: string;
        source_name: string;
        title: string;
        url: string;
        author: string | null;
        published_at: string | null;
        fetched_at: string;
        estimated_minutes: number;
        content_length: number;
        eligible: number;
        rule_outcomes: string;
      }>;

    return rows.map(row => ({
      fingerprint: row.fingerprint,
      sourceId: row.source_id,
      sourceName: row.source_name,
      title: row.title,
      url: row.url,
      author: row.author,
      publishedAt: row.published_at,
      fetchedAt: row.fetched_at,
      estimatedMinutes: row.estimated_minutes,
      contentLength: row.content_length,
      eligible: row.eligible === 1,
      ruleOutcomes: JSON.parse(row.rule_outcomes) as string[]
    }));
  }

  savePoolMaterials(materials: CandidatePoolItem[]): void {
    if (materials.length === 0) return;
    this.#database.exec("BEGIN IMMEDIATE TRANSACTION;");
    try {
      const statement = this.#database.prepare(
        `INSERT INTO candidate_pool (
          fingerprint, source_id, source_name, title, url, author,
          published_at, fetched_at, summary, content, estimated_minutes,
          format, durability_tier, provenance_json, referenced_urls_json, is_exposed, exposed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (fingerprint) DO UPDATE SET
          title = excluded.title,
          summary = excluded.summary,
          content = excluded.content,
          author = COALESCE(excluded.author, candidate_pool.author),
          published_at = COALESCE(excluded.published_at, candidate_pool.published_at),
          durability_tier = COALESCE(excluded.durability_tier, candidate_pool.durability_tier)`
      );
      for (const item of materials) {
        statement.run(
          item.fingerprint,
          item.sourceId,
          item.sourceName,
          item.title,
          item.url,
          item.author ?? null,
          item.publishedAt ?? null,
          item.fetchedAt,
          item.summary,
          item.content,
          item.estimatedMinutes,
          item.format,
          item.durabilityTier ?? "emerging",
          JSON.stringify(item.provenance),
          JSON.stringify(item.referencedUrls),
          item.isExposed ? 1 : 0,
          item.exposedAt ?? null
        );
      }
      this.#database.exec("COMMIT;");
    } catch (error) {
      this.#database.exec("ROLLBACK;");
      throw error;
    }
  }

  listUnexposedPoolMaterials(
    sourceId?: string,
    durabilityTier?: DurabilityTier,
  ): CandidatePoolItem[] {
    const conditions = ["is_exposed = 0"];
    const params: Array<string | number | null> = [];
    if (sourceId !== undefined) {
      conditions.push("source_id = ?");
      params.push(sourceId);
    }
    if (durabilityTier !== undefined) {
      conditions.push("durability_tier = ?");
      params.push(durabilityTier);
    }
    const query = `SELECT * FROM candidate_pool WHERE ${conditions.join(" AND ")} ORDER BY COALESCE(published_at, fetched_at) DESC`;
    const rows = this.#database.prepare(query).all(...params) as unknown as Array<any>;
    return rows.map(row => mapPoolRow(row));
  }

  listAllPoolMaterials(
    sourceId?: string,
    durabilityTier?: DurabilityTier,
  ): CandidatePoolItem[] {
    const conditions: string[] = [];
    const params: Array<string | number | null> = [];
    if (sourceId !== undefined) {
      conditions.push("source_id = ?");
      params.push(sourceId);
    }
    if (durabilityTier !== undefined) {
      conditions.push("durability_tier = ?");
      params.push(durabilityTier);
    }
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const query = `SELECT * FROM candidate_pool ${whereClause} ORDER BY COALESCE(published_at, fetched_at) DESC`;
    const rows = this.#database.prepare(query).all(...params) as unknown as Array<any>;
    return rows.map(row => mapPoolRow(row));
  }

  searchUnexposedPoolMaterials(
    keywords: string[],
    options?: {
      limit?: number;
      durabilityTier?: DurabilityTier;
      sourceId?: string;
    },
  ): CandidatePoolItem[] {
    const conditions = ["is_exposed = 0"];
    const params: Array<string | number | null> = [];

    if (options?.sourceId !== undefined) {
      conditions.push("source_id = ?");
      params.push(options.sourceId);
    }
    if (options?.durabilityTier !== undefined) {
      conditions.push("durability_tier = ?");
      params.push(options.durabilityTier);
    }
    if (keywords.length > 0) {
      const keywordClauses = keywords.map(() => "(title LIKE ? OR summary LIKE ? OR content LIKE ?)");
      conditions.push(`(${keywordClauses.join(" OR ")})`);
      for (const kw of keywords) {
        const pattern = `%${kw}%`;
        params.push(pattern, pattern, pattern);
      }
    }

    const limit = options?.limit ?? 50;
    const query = `SELECT * FROM candidate_pool WHERE ${conditions.join(" AND ")} ORDER BY COALESCE(published_at, fetched_at) DESC LIMIT ?`;
    params.push(limit);

    const rows = this.#database.prepare(query).all(...params) as unknown as Array<any>;
    return rows.map(row => mapPoolRow(row));
  }

  updateMaterialDurabilityTier(
    fingerprint: string,
    durabilityTier: DurabilityTier,
  ): void {
    this.#database
      .prepare("UPDATE candidate_pool SET durability_tier = ? WHERE fingerprint = ?")
      .run(durabilityTier, fingerprint);
  }

  markPoolMaterialsExposed(fingerprints: string[], exposedAt: string): void {
    if (fingerprints.length === 0) return;
    this.#database.exec("BEGIN IMMEDIATE TRANSACTION;");
    try {
      const statement = this.#database.prepare(
        "UPDATE candidate_pool SET is_exposed = 1, exposed_at = ? WHERE fingerprint = ?"
      );
      for (const fingerprint of fingerprints) {
        statement.run(exposedAt, fingerprint);
      }
      this.#database.exec("COMMIT;");
    } catch (error) {
      this.#database.exec("ROLLBACK;");
      throw error;
    }
  }

  markSourceExposed(sourceId: string, exposedAt: string): void {
    this.#database
      .prepare(
        "UPDATE candidate_pool SET is_exposed = 1, exposed_at = ? WHERE source_id = ? AND is_exposed = 0"
      )
      .run(exposedAt, sourceId);
  }

  listPoolSourcesSummary(): CandidatePoolSourceSummary[] {
    const rows = this.#database
      .prepare(
        `SELECT source_id, source_name, COUNT(*) as total_items,
                SUM(CASE WHEN is_exposed = 0 THEN 1 ELSE 0 END) as unexposed_items
         FROM candidate_pool
         GROUP BY source_id, source_name
         ORDER BY source_name`
      )
      .all() as unknown as Array<{
        source_id: string;
        source_name: string;
        total_items: number;
        unexposed_items: number;
      }>;

    return rows.map(row => ({
      sourceId: row.source_id,
      sourceName: row.source_name,
      totalItems: Number(row.total_items),
      unexposedItems: Number(row.unexposed_items),
    }));
  }

  saveCuratedEncounter(encounter: CuratedEncounter): void {
    this.#database
      .prepare(
        `INSERT INTO curated_encounters (id, pulled_at, direction, count, payload)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        encounter.id,
        encounter.pulledAt,
        encounter.direction,
        encounter.count,
        JSON.stringify(encounter)
      );
  }

  listCuratedEncounters(): CuratedEncounter[] {
    const rows = this.#database
      .prepare("SELECT payload FROM curated_encounters ORDER BY pulled_at DESC")
      .all() as unknown as Array<{ payload: string }>;
    return rows.map(row => JSON.parse(row.payload) as CuratedEncounter);
  }

  close(): void {
    if (this.#closed) return;
    this.#database.close();
    this.#closed = true;
  }
}

function mapPoolRow(row: {
  fingerprint: string;
  source_id: string;
  source_name: string;
  title: string;
  url: string;
  author: string | null;
  published_at: string | null;
  fetched_at: string;
  summary: string;
  content: string;
  estimated_minutes: number;
  format: string;
  durability_tier?: string;
  provenance_json: string;
  referenced_urls_json: string;
  is_exposed: number;
  exposed_at: string | null;
}): CandidatePoolItem {
  return {
    fingerprint: row.fingerprint,
    sourceId: row.source_id,
    sourceName: row.source_name,
    title: row.title,
    url: row.url,
    author: row.author,
    publishedAt: row.published_at,
    fetchedAt: row.fetched_at,
    summary: row.summary,
    content: row.content,
    estimatedMinutes: row.estimated_minutes,
    format: row.format as CandidatePoolItem["format"],
    durabilityTier: (row.durability_tier as DurabilityTier) || "emerging",
    provenance: JSON.parse(row.provenance_json) as string[],
    referencedUrls: JSON.parse(row.referenced_urls_json) as string[],
    isExposed: row.is_exposed === 1,
    exposedAt: row.exposed_at,
  };
}

function parseEdition(payload: string): DailyEdition {
  return JSON.parse(payload) as DailyEdition;
}

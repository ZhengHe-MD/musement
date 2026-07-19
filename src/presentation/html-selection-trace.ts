import type { SelectionTrace } from "../domain/contracts.js";
import { escapeHtml, formatExternalLink } from "./html-safety.js";

export function formatSelectionTraceAsHtml(
  localDate: string,
  trace: SelectionTrace,
): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>Musement Selection Trace — ${escapeHtml(localDate)}</title>
  <style>
    :root {
      color-scheme: light dark;
      --paper: #f3efe6;
      --panel: #fffaf0;
      --ink: #24231f;
      --muted: #6c675e;
      --line: #d8cebc;
      --accent: #8b4b35;
      --accent-soft: #ead8cb;
      --positive: #2f6c55;
      --negative: #9a4238;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--paper); color: var(--ink); line-height: 1.55; }
    main { width: min(76rem, calc(100% - 2rem)); margin: 0 auto; padding: 3.5rem 0 5rem; }
    header { display: grid; grid-template-columns: 1fr auto; gap: 1rem; align-items: end; padding-bottom: 1.4rem; border-bottom: 2px solid var(--ink); }
    h1, h2 { font-family: Iowan Old Style, Palatino Linotype, Book Antiqua, Georgia, serif; line-height: 1.08; text-wrap: balance; }
    h1 { margin: .25rem 0 0; font-size: clamp(2.4rem, 7vw, 5.2rem); }
    h2 { margin: 2.4rem 0 1rem; font-size: clamp(1.7rem, 3vw, 2.45rem); }
    h3 { margin: 0; font-size: 1.05rem; }
    .eyebrow, .label, .badge { font-size: .75rem; font-weight: 750; letter-spacing: .1em; text-transform: uppercase; }
    .eyebrow, a { color: var(--accent); }
    a { text-underline-offset: .2em; }
    .link-unavailable { color: var(--muted); font-weight: 700; }
    .date, .muted { color: var(--muted); }
    .date { text-align: right; }
    .overview { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .8rem; margin-top: 1.25rem; }
    .metric, .provider, .panel, details.record { border: 1px solid var(--line); border-radius: .4rem; background: var(--panel); }
    .metric { padding: 1rem; }
    .metric strong { display: block; font-family: Georgia, serif; font-size: 1.75rem; }
    .provider { display: flex; flex-wrap: wrap; gap: .6rem 1.4rem; margin-top: .8rem; padding: 1rem; }
    .provider span { min-width: 9rem; }
    .provider strong { display: block; overflow-wrap: anywhere; }
    .panel { padding: 1.1rem 1.25rem; }
    .decisions { margin: 0; padding-left: 1.4rem; }
    .decisions li + li { margin-top: .75rem; }
    .records { display: grid; gap: .75rem; }
    details.record { overflow: hidden; }
    details.record > summary { display: flex; justify-content: space-between; gap: 1rem; align-items: center; padding: 1rem 1.15rem; cursor: pointer; font-weight: 700; }
    details.record[open] > summary { border-bottom: 1px solid var(--line); }
    .record-body { padding: 1rem 1.15rem 1.15rem; }
    .record-body p:first-child { margin-top: 0; }
    .record-body p:last-child { margin-bottom: 0; }
    .identifiers { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .55rem 1rem; margin: 0 0 .9rem; }
    .identifiers div { min-width: 0; }
    .identifiers dt { color: var(--muted); font-size: .72rem; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
    .identifiers dd { margin: .15rem 0 0; overflow-wrap: anywhere; }
    code { font: .82rem/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; }
    .badge { flex: none; padding: .18rem .5rem; border: 1px solid currentColor; border-radius: 999px; }
    .eligible { color: var(--positive); }
    .ineligible { color: var(--negative); }
    .role-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .6rem; margin-top: .8rem; }
    .role { padding: .8rem; border: 1px solid var(--line); border-radius: .3rem; }
    .role p { margin: .35rem 0 0; }
    ul.tags { display: flex; flex-wrap: wrap; gap: .4rem; padding: 0; list-style: none; }
    ul.tags li { padding: .25rem .55rem; border-radius: .25rem; background: var(--accent-soft); overflow-wrap: anywhere; }
    pre { margin: 0; padding: 1rem; overflow: auto; border-radius: .3rem; background: color-mix(in srgb, var(--ink) 6%, transparent); font: .82rem/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
    footer { margin-top: 2rem; color: var(--muted); font-size: .85rem; }
    @media (max-width: 760px) {
      main { padding-top: 2rem; }
      header { grid-template-columns: 1fr; }
      .date { text-align: left; }
      .overview { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .role-grid { grid-template-columns: 1fr; }
      .identifiers { grid-template-columns: 1fr; }
    }
    @media (prefers-color-scheme: dark) {
      :root { --paper: #1c1b18; --panel: #26231f; --ink: #f2ebdd; --muted: #bbb2a4; --line: #4b443a; --accent: #e49a7f; --accent-soft: #56382f; --positive: #84c8aa; --negative: #ee998d; }
    }
    @media print {
      :root { color-scheme: light; --paper: white; --panel: white; --ink: #24231f; --muted: #6c675e; --line: #d8cebc; --accent: #8b4b35; --accent-soft: #ead8cb; --positive: #2f6c55; --negative: #9a4238; }
      body { background: white; }
      main { width: 100%; padding: 0; }
      details.record { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <div class="eyebrow">Inspect how the edition was assembled</div>
        <h1>Selection Trace</h1>
      </div>
      <time class="date" datetime="${escapeHtml(localDate)}">${escapeHtml(localDate)}</time>
    </header>
    <section aria-labelledby="overview-heading">
      <h2 id="overview-heading">Overview</h2>
      <div class="overview">
        ${formatMetric(trace.candidates.length, "candidate")}
        ${formatMetric(trace.assessments?.length ?? 0, "assessment")}
        ${formatMetric(trace.shortlists?.length ?? 0, "shortlist")}
        ${formatMetric(trace.decisions.length, "decision")}
      </div>
      ${formatProvider(trace)}
    </section>
    ${formatDecisions(trace.decisions)}
    ${formatShortlists(trace.shortlists ?? [])}
    ${formatCandidates(trace.candidates)}
    ${formatAssessments(trace.assessments ?? [])}
    <section aria-labelledby="raw-heading">
      <h2 id="raw-heading">Raw trace JSON</h2>
      <details class="record">
        <summary>Show the complete machine-readable trace</summary>
        <div class="record-body"><pre>${escapeHtml(JSON.stringify(trace, null, 2))}</pre></div>
      </details>
    </section>
    <footer>This trace records inspectable evidence and decisions, not hidden model chain-of-thought.</footer>
  </main>
</body>
</html>
`;
}

function formatMetric(count: number, label: string): string {
  const description = `${count} ${label}${count === 1 ? "" : "s"}`;
  return `<div class="metric" aria-label="${escapeHtml(description)}"><strong>${count}</strong>${escapeHtml(label)}${count === 1 ? "" : "s"}</div>`;
}

function formatProvider(trace: SelectionTrace): string {
  const items = [
    ["Provider", trace.provider.name],
    ["Model", trace.provider.model],
    ["Prompt", trace.provider.promptVersion],
    ["Schema", trace.provider.schemaVersion],
  ];
  return `<div class="provider">${items
    .map(
      ([label, value]) =>
        `<span><span class="label muted">${escapeHtml(label ?? "")}</span><strong>${escapeHtml(value ?? "")}</strong></span>`,
    )
    .join("")}</div>`;
}

function formatDecisions(decisions: string[]): string {
  return `<section aria-labelledby="decisions-heading">
      <h2 id="decisions-heading">Assembly decisions</h2>
      <div class="panel">${
        decisions.length === 0
          ? '<p class="muted">No assembly decisions were recorded.</p>'
          : `<ol class="decisions">${decisions.map((decision) => `<li>${escapeHtml(decision)}</li>`).join("")}</ol>`
      }</div>
    </section>`;
}

function formatShortlists(shortlists: unknown[]): string {
  return `<section aria-labelledby="shortlists-heading">
      <h2 id="shortlists-heading">Shortlists</h2>
      <div class="records">${
        shortlists.length === 0
          ? '<div class="panel muted">No shortlists were recorded.</div>'
          : shortlists.map(formatShortlist).join("")
      }</div>
    </section>`;
}

function formatShortlist(value: unknown, index: number): string {
  const record = asRecord(value);
  const role = stringValue(record?.role) ?? `Shortlist ${index + 1}`;
  const discoveryKeys = stringArray(record?.discovery_keys);
  return `<details class="record" open>
        <summary>${escapeHtml(formatLabel(role))}<span class="badge">${discoveryKeys.length} ${discoveryKeys.length === 1 ? "discovery" : "discoveries"}</span></summary>
        <div class="record-body">${
          discoveryKeys.length === 0
            ? '<p class="muted">No Discovery qualified for this shortlist.</p>'
            : `<ul class="tags">${discoveryKeys.map((key) => `<li>${escapeHtml(key)}</li>`).join("")}</ul>`
        }</div>
      </details>`;
}

function formatCandidates(candidates: unknown[]): string {
  return `<section aria-labelledby="candidates-heading">
      <h2 id="candidates-heading">Candidate materials</h2>
      <div class="records">${
        candidates.length === 0
          ? '<div class="panel muted">No candidate Materials were recorded.</div>'
          : candidates.map(formatCandidate).join("")
      }</div>
    </section>`;
}

function formatCandidate(value: unknown, index: number): string {
  const record = asRecord(value);
  if (record === null) {
    return formatUnknownRecord(`Candidate ${index + 1}`, value);
  }
  const title = stringValue(record.title) ?? `Candidate ${index + 1}`;
  const url = stringValue(record.url);
  const materialId = stringValue(record.materialId);
  const fingerprint = stringValue(record.fingerprint);
  const source = asRecord(record.source);
  const sourceName = stringValue(source?.name);
  const eligible = typeof record.eligible === "boolean" ? record.eligible : null;
  const outcomes = stringArray(record.ruleOutcomes);
  const summary = stringValue(record.derivedSummary);
  const titleMarkup = url === undefined
    ? escapeHtml(title)
    : formatExternalLink(title, url);
  return `<details class="record">
        <summary><span>${titleMarkup}${sourceName === undefined ? "" : `<span class="muted"> · ${escapeHtml(sourceName)}</span>`}</span>${
          eligible === null
            ? '<span class="badge">Unclassified</span>'
            : `<span class="badge ${eligible ? "eligible" : "ineligible"}">${eligible ? "Eligible" : "Rejected"}</span>`
        }</summary>
        <div class="record-body">
          ${formatIdentifiers([
            ["Material ID", materialId],
            ["Fingerprint", fingerprint],
          ])}
          ${summary === undefined ? "" : `<p>${escapeHtml(summary)}</p>`}
          ${outcomes.length === 0 ? '<p class="muted">No coded rule outcomes were recorded.</p>' : `<ul class="tags">${outcomes.map((outcome) => `<li>${escapeHtml(outcome)}</li>`).join("")}</ul>`}
        </div>
      </details>`;
}

function formatAssessments(assessments: unknown[]): string {
  return `<section aria-labelledby="assessments-heading">
      <h2 id="assessments-heading">Editorial assessments</h2>
      <div class="records">${
        assessments.length === 0
          ? '<div class="panel muted">No editorial assessments were recorded.</div>'
          : assessments.map(formatAssessment).join("")
      }</div>
    </section>`;
}

function formatAssessment(value: unknown, index: number): string {
  const record = asRecord(value);
  if (record === null) {
    return formatUnknownRecord(`Assessment ${index + 1}`, value);
  }
  const title = stringValue(record.title) ?? stringValue(record.discovery_key) ?? `Assessment ${index + 1}`;
  const discoveryKey = stringValue(record.discovery_key);
  const topicKey = stringValue(record.topic_key);
  const materialIds = stringArray(record.material_ids);
  const evidenceStatus = stringValue(record.evidence_status);
  const uncertainty = stringValue(record.uncertainty);
  const roleAssessments = Array.isArray(record.role_assessments)
    ? record.role_assessments
    : [];
  return `<details class="record">
        <summary>${escapeHtml(title)}<span class="badge">${roleAssessments.length} ${roleAssessments.length === 1 ? "role" : "roles"}</span></summary>
        <div class="record-body">
          ${formatIdentifiers([
            ["Discovery key", discoveryKey],
            ["Topic key", topicKey],
          ])}
          ${materialIds.length === 0 ? "" : `<p><strong>Material IDs:</strong></p><ul class="tags">${materialIds.map((id) => `<li>${escapeHtml(id)}</li>`).join("")}</ul>`}
          ${evidenceStatus === undefined ? "" : `<p><strong>Evidence:</strong> ${escapeHtml(evidenceStatus)}</p>`}
          ${uncertainty === undefined ? "" : `<p><strong>Uncertainty:</strong> ${escapeHtml(uncertainty)}</p>`}
          <div class="role-grid">${roleAssessments.map(formatRoleAssessment).join("")}</div>
        </div>
      </details>`;
}

function formatRoleAssessment(value: unknown, index: number): string {
  const record = asRecord(value);
  if (record === null) {
    return `<div class="role"><strong>Role ${index + 1}</strong><pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre></div>`;
  }
  const role = stringValue(record.role) ?? `Role ${index + 1}`;
  const eligible = typeof record.eligible === "boolean" ? record.eligible : null;
  const rationale = stringValue(record.rationale);
  return `<div class="role">
            <h3>${escapeHtml(formatLabel(role))}</h3>
            ${eligible === null ? "" : `<span class="badge ${eligible ? "eligible" : "ineligible"}">${eligible ? "Eligible" : "Not eligible"}</span>`}
            ${rationale === undefined ? "" : `<p>${escapeHtml(rationale)}</p>`}
          </div>`;
}

function formatUnknownRecord(label: string, value: unknown): string {
  return `<details class="record"><summary>${escapeHtml(label)}</summary><div class="record-body"><pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre></div></details>`;
}

function formatIdentifiers(
  identifiers: Array<readonly [label: string, value: string | undefined]>,
): string {
  const available = identifiers.filter(
    (identifier): identifier is readonly [string, string] =>
      identifier[1] !== undefined,
  );
  return available.length === 0
    ? ""
    : `<dl class="identifiers">${available.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd><code>${escapeHtml(value)}</code></dd></div>`).join("")}</dl>`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function formatLabel(value: string): string {
  return value
    .split(/[-_]/)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

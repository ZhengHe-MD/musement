import type {
  DailyEdition,
  FilledSelectionSlot,
  UnavailableSelectionSlot,
} from "../domain/contracts.js";

export function formatDailyEditionAsHtml(edition: DailyEdition): string {
  const statusLabel = edition.status === "complete" ? "Complete" : "Degraded";
  const slots = edition.slots
    .map((slot) =>
      slot.status === "filled"
        ? formatFilledSlot(slot)
        : formatUnavailableSlot(slot),
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>Musement — ${escapeHtml(edition.localDate)}</title>
  <style>
    :root {
      color-scheme: light dark;
      --paper: #f5f0e6;
      --paper-raised: #fffaf0;
      --ink: #20201d;
      --muted: #68645c;
      --line: #d8cebc;
      --accent: #9f3f2c;
      --accent-soft: #ead2c8;
      --unavailable: #776f65;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--paper);
      color: var(--ink);
      line-height: 1.6;
    }
    .edition {
      width: min(76rem, calc(100% - 2rem));
      margin: 0 auto;
      padding: 4rem 0 5rem;
    }
    .masthead {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 1rem;
      align-items: end;
      padding-bottom: 1.5rem;
      border-bottom: 2px solid var(--ink);
    }
    .eyebrow, .slot-role, .metadata, .status {
      font-size: .76rem;
      font-weight: 750;
      letter-spacing: .12em;
      text-transform: uppercase;
    }
    .eyebrow { color: var(--accent); }
    h1, h2 {
      font-family: Iowan Old Style, Palatino Linotype, Book Antiqua, Georgia, serif;
      line-height: 1.08;
      text-wrap: balance;
    }
    h1 { margin: .25rem 0 0; font-size: clamp(2.7rem, 8vw, 6.5rem); }
    h2 { margin: .55rem 0 1rem; font-size: clamp(1.65rem, 3vw, 2.7rem); }
    .date { color: var(--muted); text-align: right; }
    .status {
      display: inline-block;
      margin-top: .45rem;
      padding: .18rem .55rem;
      border: 1px solid currentColor;
      border-radius: 999px;
      color: var(--accent);
    }
    .slots {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 1.1rem;
      margin-top: 1.5rem;
    }
    .slot {
      display: flex;
      flex-direction: column;
      min-width: 0;
      padding: 1.5rem;
      border: 1px solid var(--line);
      border-radius: .35rem;
      background: var(--paper-raised);
      box-shadow: 0 .6rem 1.8rem rgb(63 49 31 / 7%);
    }
    .slot-role { color: var(--accent); }
    .summary { font-size: 1.04rem; }
    .reason {
      margin: 1rem 0;
      padding: .85rem 0 .85rem 1rem;
      border-left: .22rem solid var(--accent);
      color: var(--muted);
    }
    .material {
      margin-top: auto;
      padding-top: 1rem;
      border-top: 1px solid var(--line);
    }
    .material a { color: var(--accent); font-weight: 700; text-underline-offset: .2em; }
    .metadata { color: var(--muted); letter-spacing: .06em; }
    .detail-label { font-weight: 750; }
    .uncertainty { color: var(--muted); }
    details { margin-top: 1rem; color: var(--muted); }
    summary { cursor: pointer; font-weight: 700; color: var(--ink); }
    .unavailable { color: var(--unavailable); border-style: dashed; }
    .unavailable h2 { color: var(--ink); }
    footer { margin-top: 2rem; color: var(--muted); font-size: .85rem; }
    @media (max-width: 850px) {
      .edition { padding-top: 2rem; }
      .slots { grid-template-columns: 1fr; }
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --paper: #1c1b18;
        --paper-raised: #25231f;
        --ink: #f2ebdd;
        --muted: #bcb3a5;
        --line: #49433a;
        --accent: #e8957f;
        --accent-soft: #56352e;
        --unavailable: #aaa197;
      }
    }
    @media print {
      :root { color-scheme: light; }
      body { background: white; }
      .edition { width: 100%; padding: 0; }
      .slot { box-shadow: none; break-inside: avoid; }
      a { color: inherit !important; }
    }
  </style>
</head>
<body>
  <main class="edition">
    <header class="masthead">
      <div>
        <div class="eyebrow">A daily encounter with the wider world</div>
        <h1>Musement</h1>
      </div>
      <div class="date">
        <time datetime="${escapeHtml(edition.localDate)}">${escapeHtml(edition.localDate)}</time><br>
        <span class="status">${statusLabel}</span>
      </div>
    </header>
    <div class="slots">
${slots}
    </div>
    <footer>Generated ${escapeHtml(edition.generatedAt)} · One edition, no backlog.</footer>
  </main>
</body>
</html>
`;
}

function formatFilledSlot(slot: FilledSelectionSlot): string {
  const discovery = slot.discovery;
  const material = discovery.recommendedMaterial;
  const optionalDetails = [
    material.meaningfulEntry === undefined
      ? ""
      : `<p><span class="detail-label">Start with:</span> ${escapeHtml(material.meaningfulEntry)}</p>`,
    material.uncertainty === undefined
      ? ""
      : `<p class="uncertainty"><span class="detail-label">Uncertainty:</span> ${escapeHtml(material.uncertainty)}</p>`,
    material.accessRequirement === undefined
      ? ""
      : `<p><span class="detail-label">Access:</span> ${escapeHtml(material.accessRequirement)}</p>`,
  ].join("\n        ");
  const alternatives = discovery.alternativeMaterials
    .map(
      (alternative) =>
        `<li><a href="${safeHref(alternative.url)}" rel="noopener noreferrer">${escapeHtml(alternative.title)}</a> — ${escapeHtml(alternative.author)}, ${escapeHtml(alternative.source)}</li>`,
    )
    .join("");

  return `      <section class="slot filled" aria-labelledby="${slot.role}-title">
        <div class="slot-role">${formatRole(slot.role)}</div>
        <h2 id="${slot.role}-title">${escapeHtml(discovery.title)}</h2>
        <p class="summary">${escapeHtml(discovery.summary)}</p>
        <p class="reason"><span class="detail-label">Why this slot:</span> ${escapeHtml(discovery.slotReason)}</p>
        <p><span class="detail-label">Evidence:</span> ${escapeHtml(discovery.evidenceStatus)}</p>
        <div class="material">
          <div class="metadata">${escapeHtml(material.author)} · ${escapeHtml(material.source)} · ${escapeHtml(material.format)}</div>
          <p><a href="${safeHref(material.url)}" rel="noopener noreferrer">${escapeHtml(material.title)}</a></p>
          <p><span class="detail-label">Time:</span> ${material.meaningfulEntryMinutes} min entry · ${material.fullLengthMinutes === null ? "unknown" : `${material.fullLengthMinutes} min`} full</p>
        ${optionalDetails}
          <details>
            <summary>Provenance${alternatives.length > 0 ? " and alternatives" : ""}</summary>
            <ul>${material.provenance.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
            ${alternatives.length > 0 ? `<p class="detail-label">Alternative Materials</p><ul>${alternatives}</ul>` : ""}
          </details>
        </div>
      </section>`;
}

function formatUnavailableSlot(slot: UnavailableSelectionSlot): string {
  return `      <section class="slot unavailable">
        <div class="slot-role">${formatRole(slot.role)}</div>
        <h2>Unavailable</h2>
        <p>${escapeHtml(slot.reason)}</p>
      </section>`;
}

function formatRole(role: string): string {
  return role
    .split("-")
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] ?? character,
  );
}

function safeHref(value: string): string {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? escapeHtml(value)
      : "#";
  } catch {
    return "#";
  }
}

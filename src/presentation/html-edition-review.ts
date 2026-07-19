import type {
  DailyEdition,
  FilledSelectionSlot,
  SelectionSlotRole,
  SelectionTrace,
  UnavailableSelectionSlot,
} from "../domain/contracts.js";
import { escapeHtml, formatExternalLink } from "./html-safety.js";

type UnknownRecord = Record<string, unknown>;

const roleIndex: Record<SelectionSlotRole, string> = {
  important: "01",
  "personally-interesting": "02",
  wildcard: "03",
};

export function formatEditionReviewAsHtml(edition: DailyEdition): string {
  const trace = edition.trace;
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
  <title>Musement Edition Review — ${escapeHtml(edition.localDate)}</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f5ead8;
      --surface: #ebddc5;
      --surface-raised: #fff8ec;
      --text: #201e1d;
      --muted: #645c50;
      --divider: rgb(32 30 29 / 16%);
      --accent: #c67139;
      --accent-deep: #8c491a;
      --accent-soft: #ffe1d0;
      --sage: #7a8a5e;
      --sage-deep: #56633f;
      --sage-soft: #e1eecc;
      --wildcard: #a19786;
      --neutral-soft: #eee7db;
      --shadow-sm: 0 1px 2px rgb(46 43 37 / 14%);
      --shadow-md: 0 5px 18px rgb(46 43 37 / 14%);
      --radius-sm: .55rem;
      --radius-md: 1rem;
      --radius-lg: 1.8rem;
      --space-1: .28rem;
      --space-2: .55rem;
      --space-3: .82rem;
      --space-4: 1.1rem;
      --space-6: 1.65rem;
      --space-8: 2.2rem;
      --heading: "Cooper Black", "Iowan Old Style", Georgia, serif;
      --body: "Avenir Next", Avenir, ui-sans-serif, system-ui, sans-serif;
      font-family: var(--body);
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body { margin: 0; background: var(--bg); color: var(--text); font-size: 15px; line-height: 1.55; }
    a { color: var(--accent-deep); text-underline-offset: .2em; }
    a:hover { color: var(--accent); }
    :focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
    ::selection { background: var(--accent-soft); }
    h1, h2, h3, h4 { margin: 0; font-family: var(--heading); font-weight: 500; line-height: 1.1; letter-spacing: -.015em; text-wrap: balance; }
    p { text-wrap: pretty; }
    code, pre, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .wrap { width: min(65rem, calc(100% - 2rem)); margin-inline: auto; }
    .i18n > [lang="zh-Hans"] { display: none; }
    body:has(#language-zh:checked) .i18n > [lang="en"] { display: none; }
    body:has(#language-zh:checked) .i18n > [lang="zh-Hans"] { display: initial; }
    .language-radio { position: absolute; width: 1px; height: 1px; overflow: hidden; opacity: 0; }
    .topbar { position: sticky; top: 0; z-index: 10; background: rgb(245 234 216 / 92%); backdrop-filter: blur(12px); border-bottom: 1px solid var(--divider); }
    .nav { display: flex; align-items: center; gap: var(--space-4); min-height: 3.6rem; }
    .brand { margin-right: auto; font-family: var(--heading); font-size: 1.05rem; color: var(--text); text-decoration: none; }
    .nav-link { color: var(--text); font-size: .78rem; text-decoration: none; }
    .nav-link:hover { color: var(--accent-deep); }
    .language-switch { display: inline-flex; overflow: hidden; border: 1px solid var(--divider); border-radius: 999px; }
    .language-switch label { padding: .36rem .7rem; cursor: pointer; font-size: .72rem; }
    body:has(#language-en:checked) label[for="language-en"], body:has(#language-zh:checked) label[for="language-zh"] { background: var(--accent); color: #fff8ec; }
    body:has(#language-en:focus-visible) label[for="language-en"], body:has(#language-zh:focus-visible) label[for="language-zh"] { outline: 2px solid var(--accent); outline-offset: 2px; }
    main { padding-block: var(--space-8) 4.5rem; }
    .masthead { position: relative; overflow: hidden; margin-top: var(--space-4); padding: clamp(1.6rem, 5vw, 3.6rem); border-radius: var(--radius-lg); background: radial-gradient(120% 150% at 100% 0%, var(--accent-soft), var(--surface-raised) 58%); box-shadow: var(--shadow-sm); }
    .masthead::after { content: "03"; position: absolute; right: -1.4rem; bottom: -4.4rem; font: 12rem/1 var(--heading); color: var(--accent); opacity: .09; pointer-events: none; }
    .kicker { position: relative; z-index: 1; display: flex; flex-wrap: wrap; gap: .65rem; align-items: center; color: var(--accent-deep); font-size: .72rem; font-weight: 700; letter-spacing: .13em; text-transform: uppercase; }
    .kicker-dot { width: .35rem; height: .35rem; border-radius: 50%; background: var(--accent); }
    .masthead h1 { position: relative; z-index: 1; max-width: 16ch; margin: var(--space-3) 0 var(--space-4); font-size: clamp(2.35rem, 6.4vw, 4rem); }
    .masthead-meta { position: relative; z-index: 1; display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-4); align-items: center; }
    .tag { display: inline-flex; align-items: center; gap: .4rem; padding: .25rem .66rem; border-radius: 999px; font-size: .7rem; font-weight: 700; letter-spacing: .035em; }
    .tag-accent { background: var(--accent-soft); color: var(--accent-deep); }
    .tag-sage { background: var(--sage-soft); color: var(--sage-deep); }
    .tag-neutral { background: var(--neutral-soft); color: var(--muted); }
    .status-dot { width: .44rem; height: .44rem; border-radius: 50%; background: var(--sage); }
    .muted { color: var(--muted); }
    .section { padding-top: 4.2rem; scroll-margin-top: 4.1rem; }
    .section-heading { display: flex; gap: var(--space-3); align-items: baseline; margin-bottom: var(--space-4); }
    .section-number { color: var(--accent); font: .8rem/1 ui-monospace, monospace; letter-spacing: .1em; }
    .section-heading h2 { font-size: clamp(1.9rem, 4vw, 2.75rem); }
    .encounter { display: grid; grid-template-columns: 4.5rem 1fr; gap: var(--space-6); margin-top: var(--space-4); padding: clamp(1.25rem, 4vw, 2rem); border-left: .34rem solid var(--role-accent); border-radius: var(--radius-lg); background: var(--surface); box-shadow: var(--shadow-sm); }
    .encounter-number { color: var(--role-accent); font: 3.7rem/.86 var(--heading); text-align: center; }
    .encounter-head { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-4); align-items: center; margin-bottom: var(--space-2); }
    .encounter h3 { font-size: clamp(1.55rem, 3vw, 2rem); }
    .encounter-summary { margin: var(--space-2) 0 0; font-size: 1.05rem; }
    .why-box { margin-top: var(--space-3); padding: var(--space-3); border-radius: var(--radius-md); background: var(--role-tint); }
    .micro-label { display: block; margin-bottom: var(--space-1); color: var(--role-deep, var(--muted)); font-size: .68rem; font-weight: 750; letter-spacing: .09em; text-transform: uppercase; }
    .evidence { margin: var(--space-3) 0 0; }
    .material { display: grid; gap: var(--space-2); margin-top: var(--space-4); padding: var(--space-4); border-radius: var(--radius-lg); background: var(--surface-raised); box-shadow: var(--shadow-sm); }
    .material-title { font: 1.12rem/1.25 var(--heading); }
    .material-meta { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-4); font-size: .75rem; }
    .link-unavailable { color: var(--muted); font-weight: 700; }
    details { min-width: 0; }
    summary { cursor: pointer; list-style: none; }
    summary::-webkit-details-marker { display: none; }
    .inline-details summary { display: inline-flex; gap: .45rem; align-items: center; color: var(--accent-deep); font-size: .7rem; font-weight: 750; letter-spacing: .07em; text-transform: uppercase; }
    .inline-details summary::before, .record > summary::after { content: "⌄"; transition: transform .18s ease; }
    .inline-details[open] summary::before, .record[open] > summary::after { transform: rotate(180deg); }
    .inline-details ul { margin: var(--space-2) 0 0; padding-left: var(--space-4); font-size: .75rem; overflow-wrap: anywhere; }
    .trace-link { display: inline-block; margin-top: var(--space-3); font-size: .72rem; font-weight: 700; letter-spacing: .055em; text-transform: uppercase; text-decoration: none; }
    .unavailable { border-style: dashed; }
    .unavailable h3 { margin-top: var(--space-2); }
    .metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-3); }
    .metric, .provider, .shortlist, .record, .raw-record { border-radius: var(--radius-lg); background: var(--surface); }
    .metric { display: grid; gap: var(--space-1); padding: var(--space-4); }
    .metric strong { font: 2rem/1 var(--heading); }
    .metric span { color: var(--accent-deep); font-size: .68rem; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; }
    .provider { display: flex; flex-wrap: wrap; gap: var(--space-3) var(--space-8); margin-top: var(--space-3); padding: var(--space-4); font-size: .78rem; }
    .provider span span { color: var(--muted); }
    .subheading { margin: var(--space-8) 0 var(--space-3); color: var(--muted); font: 700 .75rem/1 var(--body); letter-spacing: .08em; text-transform: uppercase; }
    .decisions { margin: 0; padding: 0; list-style: none; }
    .decisions li { display: grid; grid-template-columns: 2.4rem 1fr; gap: var(--space-4); padding: var(--space-4) 0; border-top: 1px solid var(--divider); }
    .decision-number { color: var(--accent); font: 1.55rem/1 var(--heading); }
    .shortlists { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-3); }
    .shortlist { padding: var(--space-4); }
    .shortlist-head { display: flex; justify-content: space-between; gap: var(--space-2); align-items: baseline; padding-bottom: var(--space-2); border-bottom: 1px solid var(--divider); }
    .key-list, .outcome-list { display: flex; flex-wrap: wrap; gap: .4rem; margin: var(--space-3) 0 0; padding: 0; list-style: none; }
    .key-list a, .key-list span, .outcome-list li { display: inline-block; padding: .28rem .6rem; border-radius: 999px; background: var(--neutral-soft); color: var(--muted); font: .68rem/1.35 ui-monospace, monospace; overflow-wrap: anywhere; text-decoration: none; }
    .records { display: grid; gap: var(--space-2); }
    .record { overflow: clip; border: 1px solid transparent; }
    .record > summary { display: flex; justify-content: space-between; gap: var(--space-3); align-items: center; padding: var(--space-3) var(--space-4); }
    .record > summary::after { flex: none; color: var(--muted); }
    .record-title { min-width: 0; font-weight: 650; overflow-wrap: anywhere; }
    .record-summary-meta { display: flex; gap: var(--space-2); align-items: center; flex: none; }
    .record[open] > summary { border-bottom: 1px solid var(--divider); }
    .record-body { padding: var(--space-4); }
    .identifiers { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-2) var(--space-4); margin: 0 0 var(--space-3); }
    .identifiers div { min-width: 0; }
    .identifiers dt { color: var(--muted); font-size: .65rem; letter-spacing: .06em; text-transform: uppercase; }
    .identifiers dd { margin: .15rem 0 0; font-size: .72rem; overflow-wrap: anywhere; }
    .role-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-3); margin-top: var(--space-3); }
    .role-assessment { padding: var(--space-3); border: 1px solid var(--divider); border-radius: var(--radius-md); background: var(--bg); }
    .role-assessment-head { display: flex; justify-content: space-between; gap: var(--space-2); align-items: center; }
    .role-assessment p { margin: var(--space-2) 0 0; font-size: .82rem; }
    .candidate-link { display: block; margin-top: var(--space-2); font-size: .75rem; overflow-wrap: anywhere; }
    .raw-record { overflow: clip; }
    .raw-record summary { padding: var(--space-3) var(--space-4); color: var(--accent-deep); }
    pre { max-height: 38rem; margin: 0; padding: var(--space-4); overflow: auto; border-top: 1px solid var(--divider); background: var(--surface-raised); font-size: .72rem; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; }
    footer { display: flex; justify-content: space-between; gap: var(--space-4); margin-top: var(--space-8); padding-top: var(--space-4); border-top: 1px solid var(--divider); color: var(--muted); font-size: .72rem; }
    .role-important { --role-accent: var(--accent); --role-deep: var(--accent-deep); --role-tint: var(--accent-soft); }
    .role-personally-interesting { --role-accent: var(--sage); --role-deep: var(--sage-deep); --role-tint: var(--sage-soft); }
    .role-wildcard { --role-accent: var(--wildcard); --role-deep: var(--muted); --role-tint: var(--neutral-soft); }
    @media (max-width: 760px) {
      .nav-link { display: none; }
      .nav { gap: var(--space-2); }
      .masthead { margin-top: 0; }
      .encounter { grid-template-columns: 1fr; gap: var(--space-3); }
      .encounter-number { text-align: left; font-size: 2.5rem; }
      .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .shortlists, .role-grid, .identifiers { grid-template-columns: 1fr; }
      .record > summary { align-items: flex-start; }
      .record-summary-meta .tag { display: none; }
      footer { flex-direction: column; }
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #201d18;
        --surface: #302a22;
        --surface-raised: #3a3228;
        --text: #f6ead7;
        --muted: #c2b5a3;
        --divider: rgb(246 234 215 / 16%);
        --accent: #e39a67;
        --accent-deep: #ffc6a5;
        --accent-soft: #5b3828;
        --sage: #aebf92;
        --sage-deep: #dceabc;
        --sage-soft: #39462f;
        --wildcard: #c0b7a8;
        --neutral-soft: #494035;
      }
      .topbar { background: rgb(32 29 24 / 92%); }
      .masthead { background: radial-gradient(120% 150% at 100% 0%, var(--accent-soft), var(--surface-raised) 58%); }
    }
    @media print {
      :root {
        color-scheme: light;
        --bg: white; --surface: #f5ead8; --surface-raised: white; --text: #201e1d; --muted: #645c50;
        --divider: rgb(32 30 29 / 18%); --accent: #c67139; --accent-deep: #8c491a; --accent-soft: #ffe1d0;
        --sage: #7a8a5e; --sage-deep: #56633f; --sage-soft: #e1eecc; --neutral-soft: #eee7db;
      }
      .topbar, .language-radio, .trace-link { display: none !important; }
      main { padding: 0; }
      .wrap { width: 100%; }
      .masthead, .encounter, .metric, .provider, .shortlist, .record { box-shadow: none; }
      .encounter, .record, .shortlist { break-inside: avoid; }
      .section { padding-top: 2rem; }
      pre { max-height: none; overflow: visible; }
      a { color: inherit; }
    }
  </style>
</head>
<body>
  <input class="language-radio" type="radio" name="language" id="language-en" checked>
  <input class="language-radio" type="radio" name="language" id="language-zh">
  <div class="topbar">
    <nav class="nav wrap" aria-label="Edition Review">
      <a class="brand" href="#top">Musement</a>
      <a class="nav-link" href="#encounters">${i18n("Encounters", "邂逅")}</a>
      <a class="nav-link" href="#why">${i18n("Why", "缘由")}</a>
      <a class="nav-link" href="#inspect">${i18n("Inspect", "查阅")}</a>
      <a class="nav-link" href="#raw">${i18n("Raw", "原始")}</a>
      <div class="language-switch" aria-label="Interface language">
        <label for="language-en">EN</label>
        <label for="language-zh" lang="zh-Hans">中文</label>
      </div>
    </nav>
  </div>
  <main id="top" class="wrap">
    ${formatMasthead(edition)}
    <section id="encounters" class="section" aria-labelledby="encounters-heading">
      ${sectionHeading("01", "encounters-heading", "Today’s three encounters", "今日三则邂逅")}
${slots}
    </section>
    ${formatWhySection(trace)}
    ${formatTraceSection(trace, selectedRolesByDiscoveryKey(edition))}
    ${formatRawTrace(trace)}
    <footer>
      <span>${i18n("One edition, no backlog.", "一份精选，绝无积压。")}</span>
      <span>${i18n("This trace records inspectable evidence and decisions, not hidden model chain-of-thought.", "此记录留存可查阅的证据与决策，而非隐藏的模型思维链。")}</span>
    </footer>
  </main>
</body>
</html>
`;
}

function formatMasthead(edition: DailyEdition): string {
  const complete = edition.status === "complete";
  const [weekdayEn, weekdayZh] = weekdays(edition.localDate);
  return `<header class="masthead">
      <div class="kicker">
        ${i18n("Daily Edition", "每日精选")}
        <span class="kicker-dot" aria-hidden="true"></span>
        <time datetime="${escapeHtml(edition.localDate)}">${escapeHtml(edition.localDate)} · ${i18n(weekdayEn, weekdayZh)}</time>
      </div>
      <h1>${i18n("Three things worth stepping out for today", "今日，三件值得一读的邂逅")}</h1>
      <div class="masthead-meta">
        <span class="tag ${complete ? "tag-sage" : "tag-accent"}"><span class="status-dot" aria-hidden="true"></span>${i18n(complete ? "Complete" : "Degraded", complete ? "完整" : "降级")}</span>
        <span class="muted mono">${i18n("Generated", "生成于")} ${escapeHtml(edition.generatedAt)}</span>
      </div>
    </header>`;
}

function formatFilledSlot(slot: FilledSelectionSlot): string {
  const discovery = slot.discovery;
  const material = discovery.recommendedMaterial;
  const optionalDetails = [
    material.meaningfulEntry === undefined
      ? ""
      : `<p><span class="micro-label">${i18n("Start with", "从这里开始")}</span>${escapeHtml(material.meaningfulEntry)}</p>`,
    material.uncertainty === undefined
      ? ""
      : `<p class="muted"><span class="micro-label">${i18n("Uncertainty", "不确定性")}</span>${escapeHtml(material.uncertainty)}</p>`,
    material.accessRequirement === undefined
      ? ""
      : `<p><span class="micro-label">${i18n("Access", "访问要求")}</span>${escapeHtml(material.accessRequirement)}</p>`,
  ].join("");
  const alternatives = discovery.alternativeMaterials
    .map(
      (alternative) =>
        `<li>${formatExternalLink(alternative.title, alternative.url)} — ${escapeHtml(alternative.author)}, ${escapeHtml(alternative.source)}</li>`,
    )
    .join("");
  const assessmentAnchor = domId("assessment", discovery.subjectKey);

  return `      <article class="encounter role-${slot.role}" aria-labelledby="${slot.role}-title">
        <div class="encounter-number" aria-hidden="true">${roleIndex[slot.role]}</div>
        <div>
          <div class="encounter-head">
            <span class="tag ${roleTagClass(slot.role)}">${formatRole(slot.role)}</span>
            <span class="muted mono">${escapeHtml(material.author)} · ${escapeHtml(material.source)} · ${escapeHtml(material.format)}</span>
          </div>
          <h3 id="${slot.role}-title">${escapeHtml(discovery.title)}</h3>
          <p class="encounter-summary">${escapeHtml(discovery.summary)}</p>
          <div class="why-box">
            <span class="micro-label">${i18n("Why this slot", "为何入选此位")}</span>
            ${escapeHtml(discovery.slotReason)}
          </div>
          <p class="evidence"><strong>${i18n("Evidence", "证据")} · </strong><span class="muted">${escapeHtml(discovery.evidenceStatus)}</span></p>
          <div class="material">
            <div class="material-title">${formatExternalLink(material.title, material.url)}</div>
            <div class="material-meta muted mono">
              <span>${material.meaningfulEntryMinutes} ${i18n("min in", "分钟切入")} · ${material.fullLengthMinutes === null ? i18n("unknown total", "总时长未知") : `${material.fullLengthMinutes} ${i18n("min total", "分钟通读")}`}</span>
              <span>${escapeHtml(material.source)}</span>
            </div>
            ${optionalDetails}
            <details class="inline-details">
              <summary>${i18n(alternatives.length > 0 ? "Provenance and alternatives" : "Provenance", alternatives.length > 0 ? "来源与替代材料" : "来源")}</summary>
              <ul>${material.provenance.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
              ${alternatives.length === 0 ? "" : `<p class="micro-label">${i18n("Alternative Materials", "替代材料")}</p><ul>${alternatives}</ul>`}
            </details>
          </div>
          <a class="trace-link" href="#${assessmentAnchor}">${i18n("Trace this selection", "追溯此项甄选")} ↓</a>
        </div>
      </article>`;
}

function formatUnavailableSlot(slot: UnavailableSelectionSlot): string {
  const role = formatRole(slot.role);
  return `      <article class="encounter unavailable role-${slot.role}" aria-labelledby="${slot.role}-unavailable-title">
        <div class="encounter-number" aria-hidden="true">${roleIndex[slot.role]}</div>
        <div>
          <span class="tag ${roleTagClass(slot.role)}">${role}</span>
          <h3 id="${slot.role}-unavailable-title">${role} — ${i18n("Unavailable", "暂不可用")}</h3>
          <p class="muted">${escapeHtml(slot.reason)}</p>
        </div>
      </article>`;
}

function formatWhySection(trace: SelectionTrace): string {
  const decisions = trace.decisions.length === 0
    ? `<p class="muted">${i18n("No assembly decisions were recorded.", "未记录组装决策。")}</p>`
    : `<ol class="decisions">${trace.decisions.map((decision, index) => `<li><span class="decision-number">${String(index + 1).padStart(2, "0")}</span><span>${escapeHtml(decision)}</span></li>`).join("")}</ol>`;
  return `<section id="why" class="section" aria-labelledby="why-heading">
      ${sectionHeading("02", "why-heading", "Why this edition", "为何是这一份")}
      <div class="metrics">
        ${formatMetric(trace.candidates.length, "candidate", "candidates", "候选")}
        ${formatMetric(trace.assessments?.length ?? 0, "assessment", "assessments", "评估")}
        ${formatMetric(trace.shortlists?.length ?? 0, "shortlist", "shortlists", "入围")}
        ${formatMetric(trace.decisions.length, "decision", "decisions", "决策")}
      </div>
      ${formatProvider(trace)}
      <h4 class="subheading">${i18n("Assembly decisions", "组装决策")}</h4>
      ${decisions}
    </section>`;
}

function formatTraceSection(
  trace: SelectionTrace,
  selectedRoles: ReadonlyMap<string, SelectionSlotRole>,
): string {
  return `<section id="inspect" class="section" aria-labelledby="inspect-heading">
      ${sectionHeading("03", "inspect-heading", "Inspect the selection process", "查阅甄选过程")}
      <h4 class="subheading">${i18n("Shortlists", "入围名单")}</h4>
      ${formatShortlists(trace.shortlists ?? [])}
      <h4 class="subheading">${i18n("Editorial assessments", "编辑评估")}</h4>
      ${formatAssessments(trace.assessments ?? [], selectedRoles)}
      <h4 class="subheading">${i18n("Candidate materials", "候选材料")}</h4>
      ${formatCandidates(trace.candidates)}
    </section>`;
}

function formatShortlists(shortlists: unknown[]): string {
  if (shortlists.length === 0) {
    return `<div class="shortlist muted">${i18n("No shortlists were recorded.", "未记录入围名单。")}</div>`;
  }
  return `<div class="shortlists">${shortlists.map((value, index) => {
    const record = asRecord(value);
    const role = stringValue(record?.role);
    const keys = stringArray(record?.discovery_keys);
    return `<article class="shortlist">
          <div class="shortlist-head">
            <strong>${role === undefined ? `${i18n("Shortlist", "入围名单")} ${index + 1}` : formatRoleLabel(role)}</strong>
            <span class="muted mono">${keys.length} ${i18n(keys.length === 1 ? "discovery" : "discoveries", "项发现")}</span>
          </div>
          ${keys.length === 0 ? `<p class="muted">${i18n("No Discovery qualified.", "无发现符合要求。")}</p>` : `<ul class="key-list">${keys.map((key) => `<li><a href="#${domId("assessment", key)}">${escapeHtml(key)}</a></li>`).join("")}</ul>`}
        </article>`;
  }).join("")}</div>`;
}

function formatAssessments(
  assessments: unknown[],
  selectedRoles: ReadonlyMap<string, SelectionSlotRole>,
): string {
  if (assessments.length === 0) {
    return `<div class="shortlist muted">${i18n("No editorial assessments were recorded.", "未记录编辑评估。")}</div>`;
  }
  return `<div class="records">${assessments.map((assessment, index) => formatAssessment(assessment, index, selectedRoles)).join("")}</div>`;
}

function formatAssessment(
  value: unknown,
  index: number,
  selectedRoles: ReadonlyMap<string, SelectionSlotRole>,
): string {
  const record = asRecord(value);
  if (record === null) {
    return formatUnknownRecord(`${i18n("Assessment", "评估")} ${index + 1}`, value);
  }
  const discoveryKey = stringValue(record.discovery_key);
  const topicKey = stringValue(record.topic_key);
  const title = stringValue(record.title) ?? discoveryKey ?? `${i18n("Assessment", "评估")} ${index + 1}`;
  const materialIds = stringArray(record.material_ids);
  const evidence = stringValue(record.evidence_status);
  const uncertainty = stringValue(record.uncertainty);
  const roles = Array.isArray(record.role_assessments) ? record.role_assessments : [];
  const eligibleForAnyRole = roles.some((item) => asRecord(item)?.eligible === true);
  const selectedRole = discoveryKey === undefined
    ? undefined
    : selectedRoles.get(discoveryKey);
  const assessmentStatus = selectedRole === undefined
    ? i18n(eligibleForAnyRole ? "Eligible" : "Not eligible", eligibleForAnyRole ? "合格" : "不合格")
    : `${i18n("Selected", "入选")} · ${formatRole(selectedRole)}`;
  return `<details class="record" id="${domId("assessment", discoveryKey ?? String(index + 1))}">
        <summary>
          <span class="record-title">${escapeHtml(title)}</span>
          <span class="record-summary-meta"><span class="tag ${selectedRole !== undefined || eligibleForAnyRole ? "tag-sage" : "tag-neutral"}">${assessmentStatus}</span></span>
        </summary>
        <div class="record-body">
          ${formatIdentifiers([["Discovery key", "发现键", discoveryKey], ["Topic key", "主题键", topicKey]])}
          ${materialIds.length === 0 ? "" : `<span class="micro-label">${i18n("Material IDs", "材料 ID")}</span><ul class="outcome-list">${materialIds.map((id) => `<li>${escapeHtml(id)}</li>`).join("")}</ul>`}
          ${evidence === undefined ? "" : `<p><strong>${i18n("Evidence", "证据")} · </strong><span class="muted">${escapeHtml(evidence)}</span></p>`}
          ${uncertainty === undefined ? "" : `<p class="muted"><strong>${i18n("Uncertainty", "不确定性")} · </strong>${escapeHtml(uncertainty)}</p>`}
          ${roles.length === 0 ? "" : `<div class="role-grid">${roles.map(formatRoleAssessment).join("")}</div>`}
        </div>
      </details>`;
}

function formatRoleAssessment(value: unknown, index: number): string {
  const record = asRecord(value);
  if (record === null) {
    return `<div class="role-assessment"><strong>${i18n("Role", "角色")} ${index + 1}</strong></div>`;
  }
  const role = stringValue(record.role) ?? `${i18n("Role", "角色")} ${index + 1}`;
  const eligible = typeof record.eligible === "boolean" ? record.eligible : null;
  const rationale = stringValue(record.rationale);
  return `<div class="role-assessment">
            <div class="role-assessment-head">
              <strong>${formatRoleLabel(role)}</strong>
              ${eligible === null ? "" : `<span class="tag ${eligible ? "tag-sage" : "tag-neutral"}">${i18n(eligible ? "Eligible" : "Not eligible", eligible ? "合格" : "不合格")}</span>`}
            </div>
            ${rationale === undefined ? "" : `<p>${escapeHtml(rationale)}</p>`}
          </div>`;
}

function formatCandidates(candidates: unknown[]): string {
  if (candidates.length === 0) {
    return `<div class="shortlist muted">${i18n("No candidate Materials were recorded.", "未记录候选材料。")}</div>`;
  }
  return `<div class="records">${candidates.map(formatCandidate).join("")}</div>`;
}

function formatCandidate(value: unknown, index: number): string {
  const record = asRecord(value);
  if (record === null) {
    return formatUnknownRecord(`${i18n("Candidate", "候选")} ${index + 1}`, value);
  }
  const title = stringValue(record.title) ?? `${i18n("Candidate", "候选")} ${index + 1}`;
  const url = stringValue(record.url);
  const materialId = stringValue(record.materialId);
  const fingerprint = stringValue(record.fingerprint);
  const source = asRecord(record.source);
  const sourceName = stringValue(source?.name);
  const eligible = typeof record.eligible === "boolean" ? record.eligible : null;
  const outcomes = stringArray(record.ruleOutcomes);
  const provenance = stringArray(record.provenance);
  const summary = stringValue(record.derivedSummary);
  return `<details class="record">
        <summary>
          <span class="record-title"><span class="muted mono">${String(index + 1).padStart(2, "0")}</span> · ${escapeHtml(title)}</span>
          <span class="record-summary-meta">${eligible === null ? "" : `<span class="tag ${eligible ? "tag-sage" : "tag-neutral"}">${i18n(eligible ? "Eligible" : "Rejected", eligible ? "合格" : "淘汰")}</span>`}</span>
        </summary>
        <div class="record-body">
          ${sourceName === undefined ? "" : `<p class="muted mono">${escapeHtml(sourceName)}</p>`}
          ${url === undefined ? "" : `<span class="candidate-link">${formatExternalLink(url, url)}</span>`}
          ${formatIdentifiers([["Material ID", "材料 ID", materialId], ["Fingerprint", "指纹", fingerprint]])}
          ${provenance.length === 0 ? "" : `<span class="micro-label">${i18n("Candidate provenance", "候选材料来源")}</span><ul class="outcome-list">${provenance.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`}
          ${summary === undefined ? "" : `<p>${escapeHtml(summary)}</p>`}
          ${outcomes.length === 0 ? "" : `<ul class="outcome-list">${outcomes.map((outcome) => `<li>${escapeHtml(outcome)}</li>`).join("")}</ul>`}
        </div>
      </details>`;
}

function formatRawTrace(trace: SelectionTrace): string {
  return `<section id="raw" class="section" aria-labelledby="raw-heading">
      ${sectionHeading("04", "raw-heading", "Raw trace", "原始记录")}
      <details class="raw-record">
        <summary>${i18n("Show the complete machine-readable trace", "显示完整的机器可读记录")}</summary>
        <pre>${escapeHtml(JSON.stringify(trace, null, 2))}</pre>
      </details>
    </section>`;
}

function selectedRolesByDiscoveryKey(
  edition: DailyEdition,
): ReadonlyMap<string, SelectionSlotRole> {
  return new Map(
    edition.slots.flatMap((slot) =>
      slot.status === "filled"
        ? [[slot.discovery.subjectKey, slot.role] as const]
        : [],
    ),
  );
}

function formatMetric(
  count: number,
  singular: string,
  plural: string,
  chinese: string,
): string {
  const english = count === 1 ? singular : plural;
  return `<div class="metric" aria-label="${count} ${english}"><strong>${count}</strong><span>${i18n(english, chinese)}</span></div>`;
}

function formatProvider(trace: SelectionTrace): string {
  const items = [
    ["Provider", "供应方", trace.provider.name],
    ["Model", "模型", trace.provider.model],
    ["Prompt", "提示词", trace.provider.promptVersion],
    ["Schema", "结构", trace.provider.schemaVersion],
  ] as const;
  return `<div class="provider mono">${items.map(([english, chinese, value]) => `<span><span>${i18n(english, chinese)} </span><strong>${escapeHtml(value)}</strong></span>`).join("")}</div>`;
}

function formatIdentifiers(
  identifiers: ReadonlyArray<readonly [english: string, chinese: string, value: string | undefined]>,
): string {
  const available = identifiers.filter(
    (identifier): identifier is readonly [string, string, string] =>
      identifier[2] !== undefined,
  );
  return available.length === 0
    ? ""
    : `<dl class="identifiers">${available.map(([english, chinese, value]) => `<div><dt>${i18n(english, chinese)}</dt><dd><code>${escapeHtml(value)}</code></dd></div>`).join("")}</dl>`;
}

function formatUnknownRecord(label: string, value: unknown): string {
  return `<details class="record"><summary><span class="record-title">${label}</span></summary><div class="record-body"><pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre></div></details>`;
}

function sectionHeading(
  number: string,
  id: string,
  english: string,
  chinese: string,
): string {
  return `<div class="section-heading"><span class="section-number">${number}</span><h2 id="${id}">${i18n(english, chinese)}</h2></div>`;
}

function i18n(english: string, chinese: string): string {
  return `<span class="i18n"><span lang="en">${escapeHtml(english)}</span><span lang="zh-Hans">${escapeHtml(chinese)}</span></span>`;
}

function formatRole(role: SelectionSlotRole): string {
  const english = formatLabel(role);
  const chinese = role === "important"
    ? "重要"
    : role === "personally-interesting"
    ? "个人兴趣"
    : "意外之喜";
  return i18n(english, chinese);
}

function formatRoleLabel(role: string): string {
  return role === "important" || role === "personally-interesting" || role === "wildcard"
    ? formatRole(role)
    : escapeHtml(formatLabel(role));
}

function roleTagClass(role: SelectionSlotRole): string {
  return role === "important"
    ? "tag-accent"
    : role === "personally-interesting"
    ? "tag-sage"
    : "tag-neutral";
}

function formatLabel(value: string): string {
  return value
    .split(/[-_]/)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function weekdays(localDate: string): readonly [string, string] {
  const date = new Date(`${localDate}T00:00:00Z`);
  if (Number.isNaN(date.valueOf())) {
    return ["", ""];
  }
  return [
    new Intl.DateTimeFormat("en", { weekday: "long", timeZone: "UTC" }).format(date),
    new Intl.DateTimeFormat("zh-CN", { weekday: "long", timeZone: "UTC" }).format(date),
  ];
}

function domId(prefix: string, value: string): string {
  const token = value.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${prefix}-${token.length === 0 ? "unknown" : token}`;
}

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
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

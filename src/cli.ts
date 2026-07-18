#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { Command, Option } from "commander";

import { AiEditionEditor } from "./application/ai-edition-editor.js";
import { Musement } from "./application/musement.js";
import {
  loadConfiguration,
  type MusementConfiguration,
} from "./config/configuration.js";
import type {
  DailyEdition,
  FeedbackKind,
  NotUsefulReason,
  PreferenceProposal,
  SelectionSlotRole,
} from "./domain/contracts.js";
import {
  CodexAppServerProvider,
  type ProviderDiagnostics,
} from "./infrastructure/codex-app-server-provider.js";
import { PublicSourceCollector } from "./infrastructure/public-source-collector.js";
import { RawMaterialCache } from "./infrastructure/raw-material-cache.js";
import { SqliteMusementStore } from "./infrastructure/sqlite-musement-store.js";
import { YamlInterestProfileUpdater } from "./infrastructure/yaml-interest-profile.js";

export interface Runtime {
  musement: Musement;
  configuration?: MusementConfiguration;
  providerDiagnostics?: () => Promise<ProviderDiagnostics>;
  close(): void;
}

export interface CliDependencies {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  createRuntime: (options: {
    configPath: string;
    dataDirectory: string;
  }) => Promise<Runtime>;
}

const defaultDependencies: CliDependencies = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  createRuntime: createProductionRuntime,
};

export async function runCli(
  argv: string[],
  dependencies: CliDependencies = defaultDependencies,
): Promise<void> {
  const program = new Command();
  program
    .name("musement")
    .description("A deliberately small daily encounter with the wider world.")
    .version("0.1.0")
    .option("--config <path>", "human-owned YAML configuration", "musement.yaml")
    .option("--data-dir <path>", "local operational state", ".musement");

  program
    .command("init")
    .description("Create an editable first-user configuration")
    .option("--force", "replace an existing configuration")
    .action(async (options: { force?: boolean }) => {
      const globalOptions = program.opts<{ config: string }>();
      const configPath = resolve(globalOptions.config);
      await mkdir(dirname(configPath), { recursive: true });
      try {
        await writeFile(configPath, initialConfiguration(), {
          encoding: "utf8",
          flag: options.force === true ? "w" : "wx",
          mode: 0o600,
        });
      } catch (error) {
        if (isErrorCode(error, "EEXIST")) {
          throw new Error(
            `Configuration already exists at ${configPath}; pass --force to replace it.`,
          );
        }
        throw error;
      }
      dependencies.stdout(`Created ${configPath}\n`);
    });

  const todayAction = async (options: { json?: boolean }) => {
    const runtime = await runtimeFromProgram(program, dependencies);
    const edition = await runtime.musement.viewToday();
    dependencies.stdout(
      options.json
        ? `${JSON.stringify(edition, null, 2)}\n`
        : formatDailyEdition(edition),
    );
  };

  program
    .command("doctor")
    .description("Inspect provider authentication and rate-limit state")
    .action(async () => {
      const runtime = await runtimeFromProgram(program, dependencies);
      if (runtime.providerDiagnostics === undefined) {
        throw new Error("Provider diagnostics are unavailable.");
      }
      dependencies.stdout(
        `${JSON.stringify(await runtime.providerDiagnostics(), null, 2)}\n`,
      );
    });

  program
    .command("today")
    .description("View today's canonical Daily Edition, generating it if absent")
    .option("--json", "print stable machine-readable JSON")
    .action(todayAction);

  program
    .command("generate")
    .description("Generate today's Daily Edition if absent")
    .option("--json", "print stable machine-readable JSON")
    .action(todayAction);

  program
    .command("attempts")
    .description("Inspect Generation Attempts for a local date")
    .argument("[date]", "local date in YYYY-MM-DD")
    .action(async (date: string | undefined) => {
      const runtime = await runtimeFromProgram(program, dependencies);
      const localDate = date ?? currentLocalDate(runtime.configuration?.timezone);
      dependencies.stdout(
        `${JSON.stringify(runtime.musement.generationAttempts(localDate), null, 2)}\n`,
      );
    });

  program
    .command("trace")
    .description("Inspect a Daily Edition's Selection Trace")
    .argument("<date>", "local date in YYYY-MM-DD")
    .action(async (date: string) => {
      const runtime = await runtimeFromProgram(program, dependencies);
      const edition = runtime.musement.edition(date);
      if (edition === null) {
        throw new Error(`No Daily Edition exists for ${date}.`);
      }
      dependencies.stdout(`${JSON.stringify(edition.trace, null, 2)}\n`);
    });

  program
    .command("select")
    .description("Explicitly select a Discovery for downstream consumers")
    .argument("<date>", "Daily Edition local date")
    .addOption(
      new Option("--slot <role>", "Selection Slot").choices([
        "important",
        "personally-interesting",
        "wildcard",
      ]).makeOptionMandatory(),
    )
    .action(async (date: string, options: { slot: SelectionSlotRole }) => {
      const runtime = await runtimeFromProgram(program, dependencies);
      const event = runtime.musement.selectDiscovery({
        localDate: date,
        role: options.slot,
      });
      dependencies.stdout(`${JSON.stringify(event)}\n`);
    });

  program
    .command("outbox")
    .description("Read consumer-neutral Handoff Events")
    .option("--after <position>", "exclusive stream cursor", parseInteger, 0)
    .option("--limit <count>", "maximum events", parseInteger, 100)
    .action(async (options: { after: number; limit: number }) => {
      const runtime = await runtimeFromProgram(program, dependencies);
      const events = runtime.musement.readHandoffEvents({
        afterPosition: options.after,
        limit: options.limit,
      });
      for (const event of events) {
        dependencies.stdout(`${JSON.stringify(event)}\n`);
      }
    });

  program
    .command("feedback")
    .description("Record optional quick feedback on a Selection Slot")
    .argument("<date>", "Daily Edition local date")
    .addOption(
      new Option("--slot <role>", "Selection Slot").choices([
        "important",
        "personally-interesting",
        "wildcard",
      ]).makeOptionMandatory(),
    )
    .addOption(
      new Option("--kind <kind>", "Feedback kind").choices([
        "good-pick",
        "not-useful",
        "already-knew",
      ]).makeOptionMandatory(),
    )
    .addOption(
      new Option("--reason <reason>", "Optional Not useful reason").choices([
        "topic",
        "source",
        "depth",
        "repetition",
        "timing",
        "other",
      ]),
    )
    .action(
      async (
        date: string,
        options: {
          slot: SelectionSlotRole;
          kind: FeedbackKind;
          reason?: NotUsefulReason;
        },
      ) => {
        const runtime = await runtimeFromProgram(program, dependencies);
        const result = runtime.musement.recordFeedback({
          localDate: date,
          role: options.slot,
          kind: options.kind,
          ...(options.reason === undefined ? {} : { reason: options.reason }),
        });
        dependencies.stdout(`${JSON.stringify(result, null, 2)}\n`);
      },
    );

  program
    .command("proposals")
    .description("List non-blocking Preference Proposals")
    .addOption(
      new Option("--status <status>", "Proposal status").choices([
        "pending",
        "confirmed",
        "rejected",
      ]),
    )
    .action(async (options: { status?: PreferenceProposal["status"] }) => {
      const runtime = await runtimeFromProgram(program, dependencies);
      dependencies.stdout(
        `${JSON.stringify(runtime.musement.preferenceProposals(options.status), null, 2)}\n`,
      );
    });

  program
    .command("proposal-confirm")
    .description("Confirm and apply one Preference Proposal")
    .argument("<id>", "Preference Proposal id")
    .action(async (id: string) => {
      const runtime = await runtimeFromProgram(program, dependencies);
      const proposal = await runtime.musement.confirmPreferenceProposal(id);
      dependencies.stdout(`${JSON.stringify(proposal, null, 2)}\n`);
    });

  program
    .command("proposal-reject")
    .description("Reject one Preference Proposal")
    .argument("<id>", "Preference Proposal id")
    .action(async (id: string) => {
      const runtime = await runtimeFromProgram(program, dependencies);
      const proposal = runtime.musement.rejectPreferenceProposal(id);
      dependencies.stdout(`${JSON.stringify(proposal, null, 2)}\n`);
    });

  program
    .command("evaluation")
    .description("Review the one-time MVP evaluation window")
    .action(async () => {
      const runtime = await runtimeFromProgram(program, dependencies);
      dependencies.stdout(
        `${JSON.stringify(runtime.musement.mvpEvaluationReview(), null, 2)}\n`,
      );
    });

  program
    .command("evaluation-record")
    .description("Record the project owner's one-time MVP judgment")
    .addOption(
      new Option(
        "--worthwhile <discovery-ids...>",
        "Discoveries you probably would not otherwise have encountered",
      ).makeOptionMandatory(),
    )
    .addOption(
      new Option("--continue <answer>", "Whether you want to continue").choices([
        "yes",
        "no",
      ]).makeOptionMandatory(),
    )
    .action(
      async (options: {
        worthwhile: string[];
        continue: "yes" | "no";
      }) => {
        const runtime = await runtimeFromProgram(program, dependencies);
        const evaluation = runtime.musement.recordMvpEvaluation({
          worthwhileDiscoveryIds: options.worthwhile,
          wantsToContinue: options.continue === "yes",
        });
        dependencies.stdout(`${JSON.stringify(evaluation, null, 2)}\n`);
      },
    );

  program.configureOutput({
    writeOut: dependencies.stdout,
    writeErr: dependencies.stderr,
  });
  await program.parseAsync(argv);
}

async function runtimeFromProgram(
  program: Command,
  dependencies: CliDependencies,
): Promise<Runtime> {
  const options = program.opts<{ config: string; dataDir: string }>();
  return dependencies.createRuntime({
    configPath: resolve(options.config),
    dataDirectory: resolve(options.dataDir),
  });
}

export async function createProductionRuntime(options: {
  configPath: string;
  dataDirectory: string;
}): Promise<Runtime> {
  const configuration = await loadConfiguration(options.configPath);
  await mkdir(options.dataDirectory, { recursive: true });
  const store = new SqliteMusementStore(
    resolve(options.dataDirectory, "musement.sqlite"),
  );
  const cache = new RawMaterialCache({
    directory: resolve(options.dataDirectory, "raw-material-cache"),
    defaultRetentionDays: configuration.cache_retention_days,
  });
  const collector = new PublicSourceCollector(fetch, cache);
  const provider = new CodexAppServerProvider();
  const editor = new AiEditionEditor({ configuration, collector, provider });
  const musement = new Musement({
    store,
    editor,
    clock: { now: () => new Date() },
    timezone: configuration.timezone,
    interestProfile: new YamlInterestProfileUpdater(options.configPath),
  });
  return {
    musement,
    configuration,
    providerDiagnostics: () => provider.diagnostics(),
    close: () => store.close(),
  };
}

export function formatDailyEdition(edition: DailyEdition): string {
  const lines = [
    `Musement — ${edition.localDate}${edition.status === "degraded" ? " (degraded)" : ""}`,
    "",
  ];
  for (const slot of edition.slots) {
    const heading = slot.role.replace("-", " ").toUpperCase();
    if (slot.status === "unavailable") {
      lines.push(`${heading} — unavailable`, slot.reason, "");
      continue;
    }
    const discovery = slot.discovery;
    const material = discovery.recommendedMaterial;
    lines.push(
      heading,
      discovery.title,
      discovery.summary,
      `Why: ${discovery.slotReason}`,
      `${material.author} · ${material.source} · ${material.format}`,
      material.url,
      `Time: ${material.meaningfulEntryMinutes} min entry · ${material.fullLengthMinutes === null ? "unknown" : `${material.fullLengthMinutes} min`} full`,
    );
    if (material.meaningfulEntry !== undefined) {
      lines.push(`Start with: ${material.meaningfulEntry}`);
    }
    if (material.uncertainty !== undefined) {
      lines.push(`Uncertainty: ${material.uncertainty}`);
    }
    if (material.accessRequirement !== undefined) {
      lines.push(`Access: ${material.accessRequirement}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function currentLocalDate(timezone = Intl.DateTimeFormat().resolvedOptions().timeZone): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

function parseInteger(value: string): number {
  const result = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error(`Expected a non-negative integer, received ${value}.`);
  }
  return result;
}

function initialConfiguration(): string {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return `# Musement's human-owned configuration. Edit this file directly.
version: 1
timezone: ${timezone}
attention_budget_minutes: 25
cache_retention_days: 7

interest_profile:
  enduring: []
  current: []
  soft_suppressions: []

# Replace this example with a small set of public sources you trust.
# cache_retention_days may be set to 0 per source to prohibit raw caching.
sources:
  - id: example-feed
    name: Example Feed
    kind: rss
    url: https://example.com/feed.xml
    enabled: true
`;
}

function isErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  runCli(process.argv).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`musement: ${message}\n`);
    process.exitCode = 1;
  });
}

#!/usr/bin/env node

import { chmod, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { Command, Option } from "commander";

import { AiEditionEditor } from "./application/ai-edition-editor.js";
import { OnlinePullEditor } from "./application/online-pull-editor.js";
import {
  DailyEmailDelivery,
  type DailyEmailDeliveryResult,
} from "./application/daily-email-delivery.js";
import { Musement } from "./application/musement.js";
import { PrivateEditionSharing } from "./application/private-edition-sharing.js";
import { addPrivateEditionLink } from "./presentation/private-edition-email-link.js";
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
  CuratedEncounter,
  DurabilityTier,
} from "./domain/contracts.js";
import { DurabilityClassifier } from "./application/durability-classifier.js";
import { GitHubRssPublisher } from "./infrastructure/github-rss-publisher.js";
import {
  CodexAppServerProvider,
  type ProviderDiagnostics,
} from "./infrastructure/codex-app-server-provider.js";
import {
  PublicSourceCollector,
  createSourceFetcher,
  resolveProxyUrl,
} from "./infrastructure/public-source-collector.js";
import {
  TranscriptEnrichingCollector,
  YouTubeTranscriptConnector,
} from "./infrastructure/youtube-transcript-connector.js";
import { RawMaterialCache } from "./infrastructure/raw-material-cache.js";
import { authorizeGmailSelfDelivery } from "./infrastructure/gmail-oauth.js";
import { GmailApiSelfSender } from "./infrastructure/gmail-sender.js";
import { MacOsDailyScheduler } from "./infrastructure/macos-daily-scheduler.js";
import { MacOsPrivateSiteService } from "./infrastructure/macos-private-site-service.js";
import { SqliteMusementStore } from "./infrastructure/sqlite-musement-store.js";
import {
  type PrivateSharingManager,
  TailscalePrivateSharing,
} from "./infrastructure/tailscale-private-sharing.js";
import {
  findTailscaleExecutable,
  TailscaleServe,
} from "./infrastructure/tailscale-serve.js";
import { localDateInTimezone } from "./local-date.js";
import { hasErrorCode } from "./node-error.js";
import { YamlInterestProfileUpdater } from "./infrastructure/yaml-interest-profile.js";
import { formatEditionReviewAsHtml } from "./presentation/html-edition-review.js";
import { addPrivateSharingCommands } from "./presentation/private-sharing-commands.js";

export interface Runtime {
  musement: Musement;
  configuration?: MusementConfiguration;
  providerDiagnostics?: () => Promise<ProviderDiagnostics>;
  probeSources?: () => Promise<import("./domain/contracts.js").SourceProbeResult[]>;
  close(): void;
}

export interface CliDependencies {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  createRuntime: (options: {
    configPath: string;
    dataDirectory: string;
  }) => Promise<Runtime>;
  authorizeGmail?: (options: {
    credentialsPath: string;
  }) => Promise<{ emailAddress: string }>;
  deliverEdition?: (options: {
    localDate: string;
    html: string;
    dataDirectory: string;
  }) => Promise<DailyEmailDeliveryResult>;
  createScheduler?: () => DailyScheduler;
  createPrivateSharingManager?: (options: {
    dataDirectory: string;
    tailscalePath?: string;
  }) => Promise<PrivateSharingManager>;
}

export interface DailyScheduler {
  install(options: {
    time: string;
    timezone: string;
    configPath: string;
    dataDirectory: string;
  }): Promise<{ plistPath: string; logDirectory: string }>;
  status(): Promise<string>;
  remove(): Promise<void>;
}

const defaultDependencies: CliDependencies = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  createRuntime: createProductionRuntime,
  authorizeGmail: authorizeGmailSelfDelivery,
  deliverEdition: deliverEditionByEmail,
  createScheduler: createProductionScheduler,
  createPrivateSharingManager: createProductionPrivateSharingManager,
};

export async function runCli(
  argv: string[],
  dependencies: CliDependencies = defaultDependencies,
): Promise<void> {
  const defaultDataDirectory = join(homedir(), ".musement");
  const program = new Command();
  const runtimeHolder: { current: Runtime | null } = { current: null };
  const runtimeForCommand = async (): Promise<Runtime> => {
    runtimeHolder.current ??= await runtimeFromProgram(program, dependencies);
    return runtimeHolder.current;
  };
  program
    .name("musement")
    .description("A deliberately small daily encounter with the wider world.")
    .version("0.1.0")
    .option(
      "--config <path>",
      "human-owned YAML configuration",
      join(defaultDataDirectory, "config.yaml"),
    )
    .option(
      "--data-dir <path>",
      "local operational state",
      defaultDataDirectory,
    );

  program
    .command("gmail-auth")
    .description("Authorize Gmail to send the Daily Edition to the same account")
    .requiredOption(
      "--credentials <path>",
      "Google OAuth Desktop app credential JSON",
    )
    .action(async (options: { credentials: string }) => {
      const authorize =
        dependencies.authorizeGmail ?? authorizeGmailSelfDelivery;
      const result = await authorize({
        credentialsPath: resolve(options.credentials),
      });
      dependencies.stdout(
        `Gmail authorized for self-delivery as ${result.emailAddress}.\n`,
      );
    });

  program
    .command("deliver")
    .description("Generate today's Daily Edition and self-deliver it by Gmail")
    .action(async () => {
      const runtime = await runtimeForCommand();
      const edition = await runtime.musement.viewToday();
      const globalOptions = program.opts<{ dataDir: string }>();
      const sharing = new PrivateEditionSharing({
        dataDirectory: resolve(globalOptions.dataDir),
      });
      const editionHtml = formatEditionReviewAsHtml(edition);
      const privateUrl = await sharing.publishIfConfigured({
        localDate: edition.localDate,
        timeZone:
          runtime.configuration?.timezone ??
          Intl.DateTimeFormat().resolvedOptions().timeZone,
        html: editionHtml,
      });
      const deliver = dependencies.deliverEdition ?? deliverEditionByEmail;
      const result = await deliver({
        localDate: edition.localDate,
        html:
          privateUrl === null
            ? editionHtml
            : addPrivateEditionLink(editionHtml, privateUrl),
        dataDirectory: resolve(globalOptions.dataDir),
      });
      dependencies.stdout(
        result.status === "delivered"
          ? `Delivered the ${edition.localDate} Daily Edition to ${result.emailAddress}.\n`
          : `The ${edition.localDate} Daily Edition was already delivered to ${result.emailAddress}.\n`,
      );
    });

  const schedule = program
    .command("schedule")
    .description("Manage macOS daily email delivery");
  schedule
    .command("install")
    .description("Install or update the user LaunchAgent")
    .requiredOption("--time <HH:MM>", "daily local delivery time")
    .action(async (options: { time: string }) => {
      const globalOptions = program.opts<{ config: string; dataDir: string }>();
      const configPath = resolve(globalOptions.config);
      const dataDirectory = resolve(globalOptions.dataDir);
      const configuration = await loadConfiguration(configPath);
      const scheduler =
        dependencies.createScheduler?.() ?? createProductionScheduler();
      const installed = await scheduler.install({
        time: options.time,
        timezone: configuration.timezone,
        configPath,
        dataDirectory,
      });
      dependencies.stdout(
        `Installed daily delivery at ${options.time} ${configuration.timezone}.\nLaunchAgent: ${installed.plistPath}\nLogs: ${installed.logDirectory}\n`,
      );
    });
  schedule
    .command("status")
    .description("Show whether the user LaunchAgent is installed")
    .action(async () => {
      const scheduler =
        dependencies.createScheduler?.() ?? createProductionScheduler();
      dependencies.stdout(`Daily delivery schedule: ${await scheduler.status()}.\n`);
    });
  schedule
    .command("remove")
    .description("Unload and remove the user LaunchAgent")
    .action(async () => {
      const scheduler =
        dependencies.createScheduler?.() ?? createProductionScheduler();
      await scheduler.remove();
      dependencies.stdout("Removed the daily delivery schedule.\n");
    });

  addPrivateSharingCommands(program, {
    stdout: dependencies.stdout,
    dataDirectory: () =>
      resolve(program.opts<{ dataDir: string }>().dataDir),
    createManager: (options) =>
      createPrivateSharingManager(dependencies, options),
    loadToday: async () => {
      const runtime = await runtimeForCommand();
      const edition = await runtime.musement.viewToday();
      return {
        localDate: edition.localDate,
        timeZone:
          runtime.configuration?.timezone ??
          Intl.DateTimeFormat().resolvedOptions().timeZone,
        html: formatEditionReviewAsHtml(edition),
      };
    },
  });

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
        if (hasErrorCode(error, "EEXIST")) {
          throw new Error(
            `Configuration already exists at ${configPath}; pass --force to replace it.`,
          );
        }
        throw error;
      }
      dependencies.stdout(`Created ${configPath}\n`);
    });

  const todayAction = async (options: { html?: boolean; json?: boolean }) => {
    const runtime = await runtimeForCommand();
    const edition = await runtime.musement.viewToday();
    dependencies.stdout(
      options.html
        ? formatEditionReviewAsHtml(edition)
        : options.json
        ? `${JSON.stringify(edition, null, 2)}\n`
        : formatDailyEdition(edition),
    );
  };

  program
    .command("doctor")
    .description("Inspect provider authentication and rate-limit state")
    .option("--probe", "Probe configured sources")
    .action(async (options: { probe?: boolean }) => {
      const runtime = await runtimeForCommand();
      
      if (options.probe) {
        if (runtime.probeSources === undefined) {
          throw new Error("Source probing is not available in this runtime.");
        }
        const results = await runtime.probeSources();
        let hasError = false;
        for (const result of results) {
          if (result.status === "ok") {
            dependencies.stdout(`✓ ${result.sourceName}: OK (${result.itemCount} items, ${result.durationMs}ms)\n`);
          } else {
            dependencies.stdout(`✗ ${result.sourceName}: FAILED (${result.error})\n`);
            hasError = true;
          }
        }
        if (hasError) {
          process.exitCode = 1;
        }
        return;
      }

      if (runtime.providerDiagnostics === undefined) {
        throw new Error("Provider diagnostics are unavailable.");
      }
      dependencies.stdout(
        `${JSON.stringify(await runtime.providerDiagnostics(), null, 2)}\n`,
      );
    });

  addEditionOutputOptions(
    program
      .command("today")
      .description("View today's canonical Daily Edition, generating it if absent"),
  ).action(todayAction);

  addEditionOutputOptions(
    program
      .command("generate")
      .description("Generate today's Daily Edition if absent"),
  ).action(todayAction);

  program
    .command("collect")
    .description(
      "Collect candidate materials from sources, sync remote exposures, and update RSS feeds",
    )
    .option("--no-sync", "skip syncing remote exposures from GitHub repository")
    .action(async (options: { sync?: boolean }) => {
      const runtime = await runtimeForCommand();
      const result = await runtime.musement.collect({
        syncRemote: options.sync !== false,
      });
      dependencies.stdout(
        `Collection complete: ${result.collectedCount} candidate materials processed, ${result.remoteExposuresSynced} remote exposures synced.\n`,
      );
    });

  const pullCommand = program
    .command("pull [query]")
    .description(
      "Curate an on-demand encounter of discoveries matching a question or topic",
    )
    .option(
      "-n, --count <number>",
      "number of discoveries to select (default: 3)",
      (v) => parseInteger(v),
      3,
    )
    .option("-d, --direction <string>", "dynamic curiosity direction / topic")
    .option(
      "-t, --tier <tier>",
      "filter candidates by durability tier (evergreen, emerging, horizon)",
    );
  addEditionOutputOptions(pullCommand).action(
    async (
      query: string | undefined,
      options: {
        count: number;
        direction?: string;
        tier?: string;
        html?: boolean;
        json?: boolean;
      },
    ) => {
      const runtime = await runtimeForCommand();
      const direction = query ?? options.direction;
      const durabilityTier = options.tier as DurabilityTier | undefined;
      const encounter = await runtime.musement.pullCurated({
        count: options.count,
        ...(direction !== undefined ? { direction } : {}),
        ...(durabilityTier !== undefined ? { durabilityTier } : {}),
      });
      dependencies.stdout(
        options.html
          ? formatCuratedEncounterAsHtml(encounter)
          : options.json
          ? `${JSON.stringify(encounter, null, 2)}\n`
          : formatCuratedEncounter(encounter),
      );
    },
  );

  const poolCommand = program
    .command("pool")
    .description("Inspect candidate pool materials and sources");

  poolCommand
    .command("summary", { isDefault: true })
    .description("Show summary of candidate pool by data source")
    .action(async () => {
      const runtime = await runtimeForCommand();
      const summary = runtime.musement.getPoolSummary();
      if (summary.length === 0) {
        dependencies.stdout(
          "Candidate pool is empty. Run `musement collect` to gather materials.\n",
        );
        return;
      }
      const lines = ["Candidate Pool Summary:", ""];
      for (const s of summary) {
        lines.push(
          `• [${s.sourceId}] ${s.sourceName}: ${s.unexposedItems} unexposed / ${s.totalItems} total`,
        );
      }
      dependencies.stdout(`${lines.join("\n")}\n`);
    });

  poolCommand
    .command("list")
    .description("List unexposed candidate materials")
    .option("-s, --source <id>", "filter by source id")
    .option(
      "-t, --tier <tier>",
      "filter by durability tier (evergreen, emerging, horizon)",
    )
    .action(async (options: { source?: string; tier?: string }) => {
      const runtime = await runtimeForCommand();
      const items = runtime.musement.browsePool({
        sourceId: options.source,
        durabilityTier: options.tier as DurabilityTier | undefined,
      });
      if (items.length === 0) {
        dependencies.stdout("No unexposed candidate materials found.\n");
        return;
      }
      const lines = [`Unexposed Candidate Materials (${items.length}):`, ""];
      for (const item of items) {
        const tierBadge = item.durabilityTier
          ? `[${item.durabilityTier.toUpperCase()}]`
          : "[EMERGING]";
        lines.push(
          `• [${item.fingerprint}] ${tierBadge} [${item.sourceName}] ${item.title}`,
          `  ${item.url}`,
          `  Time: ${item.estimatedMinutes} min | Format: ${item.format}`,
          "",
        );
      }
      dependencies.stdout(`${lines.join("\n")}\n`);
    });

  poolCommand
    .command("mark-read [fingerprints...]")
    .description(
      "Mark specific candidate materials or an entire source as read/exposed",
    )
    .option(
      "-s, --source <id>",
      "mark all unexposed materials from source as read",
    )
    .action(async (fingerprints: string[], options: { source?: string }) => {
      const runtime = await runtimeForCommand();
      if (options.source) {
        await runtime.musement.markSourceRead(options.source);
        dependencies.stdout(
          `Marked all unexposed materials from source "${options.source}" as read.\n`,
        );
      } else if (fingerprints.length > 0) {
        for (const fp of fingerprints) {
          await runtime.musement.markPoolItemRead(fp);
        }
        dependencies.stdout(
          `Marked ${fingerprints.length} material(s) as read.\n`,
        );
      } else {
        dependencies.stdout(
          "Please specify one or more fingerprints or use --source <id> to mark as read.\n",
        );
      }
    });

  poolCommand
    .command("reclassify")
    .description(
      "Re-evaluate durability tiers for all candidate pool materials and update feeds",
    )
    .action(async () => {
      const runtime = await runtimeForCommand();
      dependencies.stdout("Re-evaluating durability tiers for candidate pool materials...\n");
      const result = await runtime.musement.reclassifyPool();
      dependencies.stdout(
        `Successfully classified and updated ${result.reclassifiedCount} candidate materials across Evergreen, Emerging, and Horizon tiers.\n`,
      );
    });

  const feedsCommand = program
    .command("feeds")
    .description("Manage RSS feeds export to GitHub Pages");

  feedsCommand
    .command("publish")
    .description(
      "Export curated encounters and candidate pool feeds to GitHub Pages repository",
    )
    .action(async () => {
      const runtime = await runtimeForCommand();
      const result = await runtime.musement.publishFeeds();
      if (result === null) {
        dependencies.stdout(
          "GitHub Pages export is not configured in config.yaml.\n",
        );
        return;
      }
      dependencies.stdout(
        `Published RSS feeds:\n  Curated: ${result.curatedXmlPath}\n  Pool: ${result.poolXmlPath}\n`,
      );
    });


  program
    .command("attempts")
    .description("Inspect Generation Attempts for a local date")
    .argument("[date]", "local date in YYYY-MM-DD")
    .action(async (date: string | undefined) => {
      const runtime = await runtimeForCommand();
      const localDate = date ?? currentLocalDate(runtime.configuration?.timezone);
      dependencies.stdout(
        `${JSON.stringify(runtime.musement.generationAttempts(localDate), null, 2)}\n`,
      );
    });

  program
    .command("candidates")
    .description("Display candidate snapshot for a local date")
    .argument("<date>", "local date in YYYY-MM-DD")
    .action(async (date: string) => {
      const runtime = await runtimeForCommand();
      dependencies.stdout(
        `${JSON.stringify(runtime.musement.candidateSnapshot(date), null, 2)}\n`,
      );
    });

  program
    .command("trace")
    .description("Inspect a Daily Edition's Selection Trace")
    .argument("<date>", "local date in YYYY-MM-DD")
    .option("--html", "print a standalone human-readable HTML document")
    .action(async (date: string, options: { html?: boolean }) => {
      const runtime = await runtimeForCommand();
      const edition = runtime.musement.edition(date);
      if (edition === null) {
        throw new Error(`No Daily Edition exists for ${date}.`);
      }
      dependencies.stdout(
        options.html
          ? formatEditionReviewAsHtml(edition)
          : `${JSON.stringify(edition.trace, null, 2)}\n`,
      );
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
      const runtime = await runtimeForCommand();
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
      const runtime = await runtimeForCommand();
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
        const runtime = await runtimeForCommand();
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
      const runtime = await runtimeForCommand();
      dependencies.stdout(
        `${JSON.stringify(runtime.musement.preferenceProposals(options.status), null, 2)}\n`,
      );
    });

  program
    .command("proposal-confirm")
    .description("Confirm and apply one Preference Proposal")
    .argument("<id>", "Preference Proposal id")
    .action(async (id: string) => {
      const runtime = await runtimeForCommand();
      const proposal = await runtime.musement.confirmPreferenceProposal(id);
      dependencies.stdout(`${JSON.stringify(proposal, null, 2)}\n`);
    });

  program
    .command("proposal-reject")
    .description("Reject one Preference Proposal")
    .argument("<id>", "Preference Proposal id")
    .action(async (id: string) => {
      const runtime = await runtimeForCommand();
      const proposal = runtime.musement.rejectPreferenceProposal(id);
      dependencies.stdout(`${JSON.stringify(proposal, null, 2)}\n`);
    });

  program
    .command("evaluation")
    .description("Review the one-time MVP evaluation window")
    .action(async () => {
      const runtime = await runtimeForCommand();
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
        const runtime = await runtimeForCommand();
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
  try {
    await program.parseAsync(argv);
  } finally {
    runtimeHolder.current?.close();
  }
}

export function runCliAsProcess(argv: string[] = process.argv): void {
  runCli(argv).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`musement: ${message}\n`);
    process.exitCode = 1;
  });
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
  await mkdir(options.dataDirectory, { recursive: true, mode: 0o700 });
  await chmod(options.dataDirectory, 0o700);
  const store = new SqliteMusementStore(
    resolve(options.dataDirectory, "musement.sqlite"),
  );
  const cache = new RawMaterialCache({
    directory: resolve(options.dataDirectory, "raw-material-cache"),
    defaultRetentionDays: configuration.cache_retention_days,
  });
  const fetcher = createSourceFetcher(
    resolveProxyUrl(configuration.network?.proxy_url),
  );
  const publicCollector = new PublicSourceCollector(fetcher, cache);
  const collector = new TranscriptEnrichingCollector(
    publicCollector,
    new YouTubeTranscriptConnector(store, fetcher),
  );
  const provider = new CodexAppServerProvider({
    timeoutMs: configuration.provider_timeout_seconds * 1_000,
  });
  const editor = new AiEditionEditor({ configuration, collector, provider });
  const pullEditor = new OnlinePullEditor({ configuration, provider });
  const classifier = new DurabilityClassifier({ provider });
  const rssPublisher = configuration.github_pages
    ? new GitHubRssPublisher(configuration.github_pages)
    : undefined;
  const musement = new Musement({
    store,
    editor,
    clock: { now: () => new Date() },
    timezone: configuration.timezone,
    interestProfile: new YamlInterestProfileUpdater(options.configPath),
    collector,
    pullEditor,
    classifier,
    ...(rssPublisher !== undefined ? { rssPublisher } : {}),
    configuration,
  });
  return {
    musement,
    configuration,
    providerDiagnostics: () => provider.diagnostics(),
    probeSources: () => publicCollector.probe(configuration.sources),
    close: () => store.close(),
  };
}

async function deliverEditionByEmail(options: {
  localDate: string;
  html: string;
  dataDirectory: string;
}): Promise<DailyEmailDeliveryResult> {
  return new DailyEmailDelivery({
    dataDirectory: options.dataDirectory,
    sender: new GmailApiSelfSender(),
  }).deliver({ localDate: options.localDate, html: options.html });
}

function createProductionScheduler(): DailyScheduler {
  const executablePath = process.argv[1];
  if (executablePath === undefined) {
    throw new Error("Could not determine the installed Musement executable.");
  }
  return new MacOsDailyScheduler({ executablePath });
}

async function createPrivateSharingManager(
  dependencies: CliDependencies,
  options: { dataDirectory: string; tailscalePath?: string },
): Promise<PrivateSharingManager> {
  const create =
    dependencies.createPrivateSharingManager ??
    createProductionPrivateSharingManager;
  return create(options);
}

async function createProductionPrivateSharingManager(options: {
  dataDirectory: string;
  tailscalePath?: string;
}): Promise<PrivateSharingManager> {
  if (process.platform !== "darwin") {
    throw new Error(
      "Automatic private-site installation currently supports macOS; run `musement share serve` under your operating system's service manager.",
    );
  }
  const executablePath = process.argv[1];
  if (executablePath === undefined) {
    throw new Error("Could not determine the installed Musement executable.");
  }
  const tailscalePath = await findTailscaleExecutable(options.tailscalePath);
  const sharing = new PrivateEditionSharing({
    dataDirectory: options.dataDirectory,
  });
  return new TailscalePrivateSharing({
    dataDirectory: options.dataDirectory,
    sharing,
    tailscale: new TailscaleServe({ executablePath: tailscalePath }),
    siteService: new MacOsPrivateSiteService({ executablePath }),
  });
}

export function formatDailyEdition(edition: DailyEdition): string {
  const lines = [
    `Musement — ${edition.localDate}${edition.status === "degraded" ? " (degraded)" : ""}`,
    "",
  ];
  for (const slot of edition.slots) {
    const heading = slot.role.replace("-", " ").toUpperCase();
    if (slot.status === "unavailable") {
      lines.push(`${heading} — unavailable`, slot.reason);
      if (slot.degradationCause) {
        lines.push(`Cause: ${slot.degradationCause} (Evaluated ${slot.candidatesEvaluated ?? 0} candidates)`);
      }
      lines.push("");
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

export function formatCuratedEncounter(encounter: CuratedEncounter): string {
  const lines = [
    `Musement Curated Encounter — ${new Date(encounter.pulledAt).toLocaleString()}`,
    encounter.direction ? `Direction: "${encounter.direction}"` : "Direction: Open Exploration",
    `Selected: ${encounter.count} Discovery/Discoveries`,
    "",
  ];
  if (encounter.discoveries.length === 0) {
    lines.push("No candidates met the quality and relevance floor.");
    return `${lines.join("\n")}\n`;
  }
  for (let i = 0; i < encounter.discoveries.length; i++) {
    const discovery = encounter.discoveries[i]!;
    const material = discovery.recommendedMaterial;
    lines.push(
      `[${i + 1}] ${discovery.title}`,
      discovery.summary,
      `Why: ${discovery.slotReason}`,
      `Evidence Status: ${discovery.evidenceStatus}`,
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
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

export function formatCuratedEncounterAsHtml(encounter: CuratedEncounter): string {
  const discoveriesHtml = encounter.discoveries
    .map((discovery, idx) => {
      const material = discovery.recommendedMaterial;
      return `
      <article class="encounter-card">
        <div class="encounter-header">
          <span class="encounter-num">#${idx + 1}</span>
          <span class="encounter-badge">${escapeHtml(discovery.evidenceStatus)}</span>
        </div>
        <h2 class="encounter-title"><a href="${escapeHtml(material.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(discovery.title)}</a></h2>
        <p class="encounter-summary">${escapeHtml(discovery.summary)}</p>
        <blockquote class="encounter-reason"><strong>Why selected:</strong> ${escapeHtml(discovery.slotReason)}</blockquote>
        <div class="encounter-meta">
          <span><strong>Source:</strong> ${escapeHtml(material.source)} (${escapeHtml(material.format)})</span>
          <span><strong>Author:</strong> ${escapeHtml(material.author)}</span>
          <span><strong>Read time:</strong> ${material.meaningfulEntryMinutes} min entry</span>
        </div>
      </article>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Musement Curated Encounter</title>
  <style>
    :root {
      --bg: #f8fafc;
      --card-bg: #ffffff;
      --text: #0f172a;
      --muted: #64748b;
      --accent: #2563eb;
      --border: #e2e8f0;
      --quote-bg: #f1f5f9;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0b0f19;
        --card-bg: #131b2e;
        --text: #f8fafc;
        --muted: #94a3b8;
        --accent: #38bdf8;
        --border: #1e293b;
        --quote-bg: #1e293b;
      }
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: var(--bg);
      color: var(--text);
      line-height: 1.6;
      margin: 0;
      padding: 2rem 1rem;
    }
    .container {
      max-width: 760px;
      margin: 0 auto;
    }
    header {
      margin-bottom: 2.5rem;
      border-bottom: 1px solid var(--border);
      padding-bottom: 1.5rem;
    }
    h1 { margin: 0 0 0.5rem 0; font-size: 1.8rem; font-weight: 700; }
    .direction-badge {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      background-color: var(--accent);
      color: #ffffff;
      border-radius: 9999px;
      font-size: 0.85rem;
      font-weight: 600;
      margin-top: 0.5rem;
    }
    .encounter-card {
      background-color: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1.75rem;
      margin-bottom: 2rem;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
    }
    .encounter-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.75rem;
    }
    .encounter-num {
      font-size: 1.1rem;
      font-weight: 700;
      color: var(--accent);
    }
    .encounter-badge {
      font-size: 0.8rem;
      color: var(--muted);
    }
    .encounter-title {
      font-size: 1.35rem;
      margin: 0 0 0.75rem 0;
    }
    .encounter-title a {
      color: var(--text);
      text-decoration: none;
    }
    .encounter-title a:hover {
      color: var(--accent);
      text-decoration: underline;
    }
    .encounter-summary { margin: 0 0 1rem 0; }
    .encounter-reason {
      margin: 1rem 0;
      padding: 0.75rem 1rem;
      background-color: var(--quote-bg);
      border-left: 4px solid var(--accent);
      border-radius: 4px;
      font-size: 0.95rem;
    }
    .encounter-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 1rem;
      font-size: 0.85rem;
      color: var(--muted);
      margin-top: 1rem;
      padding-top: 0.75rem;
      border-top: 1px dashed var(--border);
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>Musement Curated Encounter</h1>
      <p style="color: var(--muted); margin: 0;">Pulled: ${new Date(encounter.pulledAt).toLocaleString()}</p>
      ${encounter.direction ? `<span class="direction-badge">${escapeHtml(encounter.direction)}</span>` : ""}
    </header>
    <main>
      ${discoveriesHtml || "<p>No discoveries met the quality floor for this pull.</p>"}
    </main>
  </div>
</body>
</html>`;
}

function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function addEditionOutputOptions(command: Command): Command {
  return command
    .addOption(
      new Option("--json", "print stable machine-readable JSON").conflicts(
        "html",
      ),
    )
    .addOption(
      new Option(
        "--html",
        "print a standalone human-readable HTML document",
      ).conflicts("json"),
    );
}

function currentLocalDate(timezone = Intl.DateTimeFormat().resolvedOptions().timeZone): string {
  return localDateInTimezone(new Date(), timezone);
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
provider_timeout_seconds: 300
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

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  runCliAsProcess();
}

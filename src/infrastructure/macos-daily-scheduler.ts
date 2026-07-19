import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const launchAgentLabel = "com.musement.daily";

type CommandRunner = (file: string, arguments_: string[]) => Promise<void>;

export class MacOsDailyScheduler {
  readonly #homeDirectory: string;
  readonly #userId: number;
  readonly #executablePath: string;
  readonly #systemTimezone: string;
  readonly #run: CommandRunner;

  constructor(options: {
    homeDirectory?: string;
    userId?: number;
    executablePath: string;
    systemTimezone?: string;
    run?: CommandRunner;
  }) {
    this.#homeDirectory = resolve(options.homeDirectory ?? homedir());
    this.#userId = options.userId ?? process.getuid?.() ?? 0;
    this.#executablePath = resolve(options.executablePath);
    this.#systemTimezone =
      options.systemTimezone ??
      Intl.DateTimeFormat().resolvedOptions().timeZone;
    this.#run = options.run ?? runCommand;
  }

  async install(options: {
    time: string;
    timezone: string;
    configPath: string;
    dataDirectory: string;
  }): Promise<{ plistPath: string; logDirectory: string }> {
    if (options.timezone !== this.#systemTimezone) {
      throw new Error(
        `Configured timezone ${options.timezone} does not match the Mac timezone ${this.#systemTimezone}; launchd calendar schedules use the Mac timezone.`,
      );
    }
    const { hour, minute } = parseTime(options.time);
    const plistPath = resolve(
      this.#homeDirectory,
      "Library/LaunchAgents",
      `${launchAgentLabel}.plist`,
    );
    const logDirectory = resolve(options.dataDirectory, "logs");
    await Promise.all([
      mkdir(dirname(plistPath), { recursive: true }),
      mkdir(logDirectory, { recursive: true, mode: 0o700 }),
    ]);
    await chmod(logDirectory, 0o700);
    const temporaryPath = `${plistPath}.${process.pid}.tmp`;
    await writeFile(
      temporaryPath,
      launchAgentPlist({
        hour,
        minute,
        executablePath: this.#executablePath,
        configPath: resolve(options.configPath),
        dataDirectory: resolve(options.dataDirectory),
        logDirectory,
        homeDirectory: this.#homeDirectory,
      }),
      { mode: 0o600 },
    );
    await rename(temporaryPath, plistPath);

    await this.#run("/bin/launchctl", [
      "bootout",
      `gui/${this.#userId}/${launchAgentLabel}`,
    ]).catch(() => undefined);
    await this.#run("/bin/launchctl", [
      "bootstrap",
      `gui/${this.#userId}`,
      plistPath,
    ]);
    return { plistPath, logDirectory };
  }

  async status(): Promise<string> {
    try {
      await this.#run("/bin/launchctl", [
        "print",
        `gui/${this.#userId}/${launchAgentLabel}`,
      ]);
      return "loaded";
    } catch {
      // A plist may still exist even when launchd has not loaded the job.
    }
    const outputPath = resolve(
      this.#homeDirectory,
      "Library/LaunchAgents",
      `${launchAgentLabel}.plist`,
    );
    try {
      await readFile(outputPath, "utf8");
      return "installed-but-not-loaded";
    } catch (error) {
      if (isErrorCode(error, "ENOENT")) {
        return "not-installed";
      }
      throw error;
    }
  }

  async remove(): Promise<void> {
    const plistPath = resolve(
      this.#homeDirectory,
      "Library/LaunchAgents",
      `${launchAgentLabel}.plist`,
    );
    await this.#run("/bin/launchctl", [
      "bootout",
      `gui/${this.#userId}/${launchAgentLabel}`,
    ]).catch(() => undefined);
    await rm(plistPath, { force: true });
  }
}

function launchAgentPlist(options: {
  hour: number;
  minute: number;
  executablePath: string;
  configPath: string;
  dataDirectory: string;
  logDirectory: string;
  homeDirectory: string;
}): string {
  const arguments_ = [
    options.executablePath,
    "--config",
    options.configPath,
    "--data-dir",
    options.dataDirectory,
    "deliver",
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${launchAgentLabel}</string>
  <key>ProgramArguments</key>
  <array>${arguments_.map((argument) => `\n    <string>${xmlEscape(argument)}</string>`).join("")}
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>${options.hour}</integer>
    <key>Minute</key><integer>${options.minute}</integer>
  </dict>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key><string>${xmlEscape(options.homeDirectory)}</string>
    <key>PATH</key><string>${xmlEscape(`${options.homeDirectory}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`)}</string>
  </dict>
  <key>StandardOutPath</key><string>${xmlEscape(resolve(options.logDirectory, "daily-delivery.log"))}</string>
  <key>StandardErrorPath</key><string>${xmlEscape(resolve(options.logDirectory, "daily-delivery.error.log"))}</string>
  <key>ProcessType</key><string>Background</string>
  <key>LowPriorityIO</key><true/>
</dict>
</plist>
`;
}

function parseTime(value: string): { hour: number; minute: number } {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (match === null) {
    throw new Error(`Invalid daily time ${value}; expected HH:MM.`);
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    throw new Error(`Invalid daily time ${value}; expected HH:MM.`);
  }
  return { hour, minute };
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

async function runCommand(file: string, arguments_: string[]): Promise<void> {
  await execFileAsync(file, arguments_);
}

function isErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

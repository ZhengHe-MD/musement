import { chmod, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

import {
  type CommandRunner,
  MacOsLaunchAgent,
  xmlEscape,
} from "./macos-launch-agent.js";

const launchAgentLabel = "com.musement.daily";

export class MacOsDailyScheduler {
  readonly #homeDirectory: string;
  readonly #executablePath: string;
  readonly #systemTimezone: string;
  readonly #launchAgent: MacOsLaunchAgent;

  constructor(options: {
    homeDirectory?: string;
    userId?: number;
    executablePath: string;
    systemTimezone?: string;
    run?: CommandRunner;
  }) {
    this.#homeDirectory = resolve(options.homeDirectory ?? homedir());
    this.#executablePath = resolve(options.executablePath);
    this.#systemTimezone =
      options.systemTimezone ??
      Intl.DateTimeFormat().resolvedOptions().timeZone;
    this.#launchAgent = new MacOsLaunchAgent({
      homeDirectory: this.#homeDirectory,
      ...(options.userId === undefined ? {} : { userId: options.userId }),
      ...(options.run === undefined ? {} : { run: options.run }),
    });
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
    const logDirectory = resolve(options.dataDirectory, "logs");
    await mkdir(logDirectory, { recursive: true, mode: 0o700 });
    await chmod(logDirectory, 0o700);
    const plistPath = await this.#launchAgent.install({
      label: launchAgentLabel,
      plist: launchAgentPlist({
        hour,
        minute,
        executablePath: this.#executablePath,
        configPath: resolve(options.configPath),
        dataDirectory: resolve(options.dataDirectory),
        logDirectory,
        homeDirectory: this.#homeDirectory,
      }),
    });
    return { plistPath, logDirectory };
  }

  async status(): Promise<string> {
    return this.#launchAgent.status(launchAgentLabel);
  }

  async remove(): Promise<void> {
    await this.#launchAgent.remove(launchAgentLabel);
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
    "collect",
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
  <key>StandardOutPath</key><string>${xmlEscape(resolve(options.logDirectory, "daily-collection.log"))}</string>
  <key>StandardErrorPath</key><string>${xmlEscape(resolve(options.logDirectory, "daily-collection.error.log"))}</string>
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

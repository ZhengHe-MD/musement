import { chmod, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

import {
  type CommandRunner,
  MacOsLaunchAgent,
  xmlEscape,
} from "./macos-launch-agent.js";

const launchAgentLabel = "com.musement.private-site";

export class MacOsPrivateSiteService {
  readonly #homeDirectory: string;
  readonly #executablePath: string;
  readonly #launchAgent: MacOsLaunchAgent;

  constructor(options: {
    homeDirectory?: string;
    userId?: number;
    executablePath: string;
    run?: CommandRunner;
  }) {
    this.#homeDirectory = resolve(options.homeDirectory ?? homedir());
    this.#executablePath = resolve(options.executablePath);
    this.#launchAgent = new MacOsLaunchAgent({
      homeDirectory: this.#homeDirectory,
      ...(options.userId === undefined ? {} : { userId: options.userId }),
      ...(options.run === undefined ? {} : { run: options.run }),
    });
  }

  async install(options: {
    dataDirectory: string;
    port: number;
  }): Promise<{ plistPath: string; logDirectory: string }> {
    const dataDirectory = resolve(options.dataDirectory);
    const logDirectory = resolve(dataDirectory, "logs");
    await mkdir(logDirectory, { recursive: true, mode: 0o700 });
    await chmod(logDirectory, 0o700);
    const plistPath = await this.#launchAgent.install({
      label: launchAgentLabel,
      plist: privateSitePlist({
        executablePath: this.#executablePath,
        dataDirectory,
        port: options.port,
        logDirectory,
        homeDirectory: this.#homeDirectory,
      }),
    });
    return { plistPath, logDirectory };
  }

  status(): Promise<string> {
    return this.#launchAgent.status(launchAgentLabel);
  }

  remove(): Promise<void> {
    return this.#launchAgent.remove(launchAgentLabel);
  }
}

function privateSitePlist(options: {
  executablePath: string;
  dataDirectory: string;
  port: number;
  logDirectory: string;
  homeDirectory: string;
}): string {
  const arguments_ = [
    options.executablePath,
    "--data-dir",
    options.dataDirectory,
    "share",
    "serve",
    "--port",
    String(options.port),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${launchAgentLabel}</string>
  <key>ProgramArguments</key>
  <array>${arguments_.map((argument) => `\n    <string>${xmlEscape(argument)}</string>`).join("")}
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key><string>${xmlEscape(options.homeDirectory)}</string>
    <key>PATH</key><string>${xmlEscape(`${options.homeDirectory}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`)}</string>
  </dict>
  <key>StandardOutPath</key><string>${xmlEscape(resolve(options.logDirectory, "private-site.log"))}</string>
  <key>StandardErrorPath</key><string>${xmlEscape(resolve(options.logDirectory, "private-site.error.log"))}</string>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
`;
}

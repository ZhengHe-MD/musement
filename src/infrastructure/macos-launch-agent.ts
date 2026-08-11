import { execFile } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { hasErrorCode } from "../node-error.js";

const execFileAsync = promisify(execFile);

export type CommandRunner = (
  file: string,
  arguments_: string[],
) => Promise<void>;

export class MacOsLaunchAgent {
  readonly #homeDirectory: string;
  readonly #userId: number;
  readonly #run: CommandRunner;

  constructor(options: {
    homeDirectory?: string;
    userId?: number;
    run?: CommandRunner;
  } = {}) {
    this.#homeDirectory = resolve(options.homeDirectory ?? homedir());
    this.#userId = options.userId ?? process.getuid?.() ?? 0;
    this.#run = options.run ?? runCommand;
  }

  async install(options: { label: string; plist: string }): Promise<string> {
    const plistPath = this.plistPath(options.label);
    await mkdir(resolve(this.#homeDirectory, "Library/LaunchAgents"), {
      recursive: true,
    });
    const temporaryPath = `${plistPath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, options.plist, { mode: 0o600 });
    await rename(temporaryPath, plistPath);
    await this.#bootout(options.label);
    await this.#run("/bin/launchctl", [
      "bootstrap",
      `gui/${this.#userId}`,
      plistPath,
    ]);
    return plistPath;
  }

  async status(label: string): Promise<string> {
    try {
      await this.#run("/bin/launchctl", [
        "print",
        `gui/${this.#userId}/${label}`,
      ]);
      return "loaded";
    } catch {
      // A plist may still exist even when launchd has not loaded the job.
    }
    try {
      await readFile(this.plistPath(label), "utf8");
      return "installed-but-not-loaded";
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) {
        return "not-installed";
      }
      throw error;
    }
  }

  async remove(label: string): Promise<void> {
    await this.#bootout(label);
    await rm(this.plistPath(label), { force: true });
  }

  plistPath(label: string): string {
    return resolve(
      this.#homeDirectory,
      "Library/LaunchAgents",
      `${label}.plist`,
    );
  }

  async #bootout(label: string): Promise<void> {
    const target = `gui/${this.#userId}/${label}`;
    try {
      await this.#run("/bin/launchctl", ["bootout", "--wait", target]);
    } catch (error) {
      try {
        await this.#run("/bin/launchctl", ["print", target]);
      } catch {
        return;
      }
      throw error;
    }
  }
}

export function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

async function runCommand(file: string, arguments_: string[]): Promise<void> {
  await execFileAsync(file, arguments_, { timeout: 15_000 });
}

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { MacOsDailyScheduler } from "../src/infrastructure/macos-daily-scheduler.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("macOS Daily Edition scheduling", () => {
  it("installs a user LaunchAgent at the requested local time", async () => {
    const homeDirectory = await mkdtemp(join(tmpdir(), "musement-launchd-"));
    temporaryDirectories.push(homeDirectory);
    const commands: Array<{ file: string; arguments_: string[] }> = [];
    const scheduler = new MacOsDailyScheduler({
      homeDirectory,
      userId: 501,
      executablePath: "/opt/homebrew/bin/musement",
      run: async (file, arguments_) => {
        commands.push({ file, arguments_ });
      },
    });
    const dataDirectory = join(homeDirectory, ".musement");
    const configPath = join(dataDirectory, "config.yaml");

    const result = await scheduler.install({
      time: "08:30",
      timezone: "Asia/Shanghai",
      configPath,
      dataDirectory,
    });

    const plist = await readFile(result.plistPath, "utf8");
    expect(plist).toContain("<key>Hour</key><integer>8</integer>");
    expect(plist).toContain("<key>Minute</key><integer>30</integer>");
    expect(plist).toContain("<string>/opt/homebrew/bin/musement</string>");
    expect(plist).toContain("<string>collect</string>");
    expect(plist).toContain(`<string>${configPath}</string>`);
    expect(plist).toContain(`<string>${dataDirectory}</string>`);
    expect(commands.at(-1)).toEqual({
      file: "/bin/launchctl",
      arguments_: ["bootstrap", "gui/501", result.plistPath],
    });
  });

  it("rejects scheduling in a timezone different from the Mac", async () => {
    const homeDirectory = await mkdtemp(join(tmpdir(), "musement-launchd-"));
    temporaryDirectories.push(homeDirectory);
    const scheduler = new MacOsDailyScheduler({
      homeDirectory,
      userId: 501,
      executablePath: "/opt/homebrew/bin/musement",
      systemTimezone: "Asia/Shanghai",
      run: async () => undefined,
    });

    await expect(
      scheduler.install({
        time: "08:30",
        timezone: "America/New_York",
        configPath: "/tmp/config.yaml",
        dataDirectory: "/tmp/data",
      }),
    ).rejects.toThrow("Mac timezone");
  });

  it("distinguishes a loaded job from a plist that is only present on disk", async () => {
    const homeDirectory = await mkdtemp(join(tmpdir(), "musement-launchd-"));
    temporaryDirectories.push(homeDirectory);
    const scheduler = new MacOsDailyScheduler({
      homeDirectory,
      userId: 501,
      executablePath: "/opt/homebrew/bin/musement",
      run: async (_file, arguments_) => {
        if (arguments_[0] === "print") {
          throw new Error("not loaded");
        }
      },
    });
    const dataDirectory = join(homeDirectory, ".musement");
    await scheduler.install({
      time: "08:30",
      timezone: "Asia/Shanghai",
      configPath: join(dataDirectory, "config.yaml"),
      dataDirectory,
    });

    await expect(scheduler.status()).resolves.toBe("installed-but-not-loaded");
  });
});

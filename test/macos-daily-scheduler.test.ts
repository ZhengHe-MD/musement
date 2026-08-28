import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

describe("macOS Daily Edition delivery scheduling", () => {
  it("installs a dedicated delivery LaunchAgent at the requested local time", async () => {
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
    expect(plist).toContain(
      "<key>Label</key><string>com.musement.daily-delivery</string>",
    );
    expect(plist).toContain("<string>/opt/homebrew/bin/musement</string>");
    expect(plist).toContain("<string>deliver</string>");
    expect(plist).toContain("daily-delivery.log");
    expect(plist).toContain("daily-delivery.error.log");
    expect(plist).toContain(`<string>${configPath}</string>`);
    expect(plist).toContain(`<string>${dataDirectory}</string>`);
    expect(result.plistPath).toBe(
      join(
        homeDirectory,
        "Library/LaunchAgents/com.musement.daily-delivery.plist",
      ),
    );
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

  it("removes only the daily delivery agent and leaves collection untouched", async () => {
    const homeDirectory = await mkdtemp(join(tmpdir(), "musement-launchd-"));
    temporaryDirectories.push(homeDirectory);
    const launchAgentsDirectory = join(homeDirectory, "Library/LaunchAgents");
    await mkdir(launchAgentsDirectory, { recursive: true });
    const collectionPlistPath = join(
      launchAgentsDirectory,
      "com.musement.daily.plist",
    );
    const deliveryPlistPath = join(
      launchAgentsDirectory,
      "com.musement.daily-delivery.plist",
    );
    await writeFile(collectionPlistPath, "collection");
    await writeFile(deliveryPlistPath, "delivery");
    const commands: Array<{ file: string; arguments_: string[] }> = [];
    const scheduler = new MacOsDailyScheduler({
      homeDirectory,
      userId: 501,
      executablePath: "/opt/homebrew/bin/musement",
      run: async (file, arguments_) => {
        commands.push({ file, arguments_ });
      },
    });

    await scheduler.remove();

    await expect(readFile(collectionPlistPath, "utf8")).resolves.toBe(
      "collection",
    );
    await expect(readFile(deliveryPlistPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(commands).toEqual([
      {
        file: "/bin/launchctl",
        arguments_: [
          "bootout",
          "--wait",
          "gui/501/com.musement.daily-delivery",
        ],
      },
    ]);
  });
});

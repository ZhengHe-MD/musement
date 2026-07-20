import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { MacOsLaunchAgent } from "../src/infrastructure/macos-launch-agent.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("macOS LaunchAgent lifecycle", () => {
  it("does not bootstrap when a failed bootout leaves the old job loaded", async () => {
    const homeDirectory = await mkdtemp(join(tmpdir(), "musement-agent-"));
    temporaryDirectories.push(homeDirectory);
    const commands: string[][] = [];
    const agent = new MacOsLaunchAgent({
      homeDirectory,
      userId: 501,
      run: async (_file, arguments_) => {
        commands.push(arguments_);
        if (arguments_[0] === "bootout") {
          throw new Error("bootout timed out");
        }
      },
    });

    await expect(
      agent.install({ label: "com.musement.test", plist: "test plist" }),
    ).rejects.toThrow("bootout timed out");
    expect(commands).toEqual([
      ["bootout", "--wait", "gui/501/com.musement.test"],
      ["print", "gui/501/com.musement.test"],
    ]);
  });

  it("continues when bootout fails because the old job is already absent", async () => {
    const homeDirectory = await mkdtemp(join(tmpdir(), "musement-agent-"));
    temporaryDirectories.push(homeDirectory);
    const commands: string[][] = [];
    const agent = new MacOsLaunchAgent({
      homeDirectory,
      userId: 501,
      run: async (_file, arguments_) => {
        commands.push(arguments_);
        if (arguments_[0] === "bootout" || arguments_[0] === "print") {
          throw new Error("service not found");
        }
      },
    });

    await expect(
      agent.install({ label: "com.musement.test", plist: "test plist" }),
    ).resolves.toContain("com.musement.test.plist");
    expect(commands.at(-1)?.[0]).toBe("bootstrap");
  });
});

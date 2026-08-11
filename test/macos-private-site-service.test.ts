import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { MacOsPrivateSiteService } from "../src/infrastructure/macos-private-site-service.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("macOS private Daily Edition service", () => {
  it("installs a persistent localhost-only Musement server", async () => {
    const homeDirectory = await mkdtemp(join(tmpdir(), "musement-site-agent-"));
    temporaryDirectories.push(homeDirectory);
    const commands: Array<{ file: string; arguments_: string[] }> = [];
    const service = new MacOsPrivateSiteService({
      homeDirectory,
      userId: 501,
      executablePath: "/opt/homebrew/bin/musement",
      run: async (file, arguments_) => {
        commands.push({ file, arguments_ });
      },
    });
    const dataDirectory = join(homeDirectory, ".musement");

    const installed = await service.install({
      dataDirectory,
      port: 43_187,
    });

    const plist = await readFile(installed.plistPath, "utf8");
    expect(plist).toContain("<string>share</string>");
    expect(plist).toContain("<string>serve</string>");
    expect(plist).toContain("<string>43187</string>");
    expect(plist).toContain("<key>RunAtLoad</key><true/>");
    expect(plist).toContain("<key>KeepAlive</key><true/>");
    expect(commands.at(-2)).toEqual({
      file: "/bin/launchctl",
      arguments_: [
        "bootout",
        "--wait",
        "gui/501/com.musement.private-site",
      ],
    });
    expect(commands.at(-1)).toEqual({
      file: "/bin/launchctl",
      arguments_: ["bootstrap", "gui/501", installed.plistPath],
    });
  });
});

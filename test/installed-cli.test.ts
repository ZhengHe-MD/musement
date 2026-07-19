import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import type { DailyEdition } from "../src/domain/contracts.js";
import { SqliteMusementStore } from "../src/infrastructure/sqlite-musement-store.js";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryDirectories: string[] = [];
const unrelatedExperimentalWarningPreload =
  "--import=data:text/javascript,process.emitWarning(%22Unrelated%20experimental%20warning%22%2C%20%22ExperimentalWarning%22)";

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("installed Musement CLI", () => {
  it("runs through its package symlink without experimental warnings", async () => {
    const { linkedExecutable } = await createLinkedCliFixture(
      "musement-installed-cli-",
    );

    const { stdout, stderr } = await execFileAsync(linkedExecutable, ["--help"]);

    expect(stdout).toContain("Usage: musement");
    expect(stderr).not.toContain("ExperimentalWarning");
  });

  it("uses user-scoped configuration and state from every working directory", async () => {
    const { directory, linkedExecutable } = await createLinkedCliFixture(
      "musement-user-config-",
    );
    const isolatedHome = join(directory, "home");
    const unrelatedWorkingDirectory = join(directory, "elsewhere");

    await Promise.all([mkdir(isolatedHome), mkdir(unrelatedWorkingDirectory)]);

    const { stderr: initStderr } = await execFileAsync(
      linkedExecutable,
      ["init"],
      {
        cwd: unrelatedWorkingDirectory,
        env: { ...process.env, HOME: isolatedHome },
      },
    );
    const { stderr: evaluationStderr } = await execFileAsync(
      linkedExecutable,
      ["evaluation"],
      {
        cwd: unrelatedWorkingDirectory,
        env: {
          ...process.env,
          HOME: isolatedHome,
          NODE_OPTIONS: [
            process.env.NODE_OPTIONS,
            unrelatedExperimentalWarningPreload,
          ]
            .filter((option) => option !== undefined)
            .join(" "),
        },
      },
    );

    const configuration = await readFile(
      join(isolatedHome, ".musement", "config.yaml"),
      "utf8",
    );
    const database = await readFile(
      join(isolatedHome, ".musement", "musement.sqlite"),
    );
    expect(configuration).toContain("version: 1");
    expect(database.byteLength).toBeGreaterThan(0);
    await expect(
      readFile(join(unrelatedWorkingDirectory, "musement.yaml"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(
        join(unrelatedWorkingDirectory, ".musement", "musement.sqlite"),
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(initStderr).not.toContain("ExperimentalWarning");
    expect(evaluationStderr).not.toContain(
      "SQLite is an experimental feature",
    );
    expect(evaluationStderr).toContain(
      "ExperimentalWarning: Unrelated experimental warning",
    );

    seedEditionForToday(
      join(isolatedHome, ".musement", "musement.sqlite"),
    );
    const { stdout: html, stderr: todayStderr } = await execFileAsync(
      linkedExecutable,
      ["today", "--html"],
      {
        cwd: unrelatedWorkingDirectory,
        env: { ...process.env, HOME: isolatedHome },
      },
    );
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain("Musement Edition Review");
    expect(todayStderr).not.toContain("ExperimentalWarning");
  });
});

async function createLinkedCliFixture(prefix: string): Promise<{
  directory: string;
  linkedExecutable: string;
}> {
  const packageJson = JSON.parse(
    await readFile(join(repositoryRoot, "package.json"), "utf8"),
  ) as { bin: { musement: string } };
  const executable = resolve(repositoryRoot, packageJson.bin.musement);
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  const linkedExecutable = join(directory, "musement");

  await chmod(executable, 0o755);
  await symlink(executable, linkedExecutable);

  return { directory, linkedExecutable };
}

function seedEditionForToday(databasePath: string): void {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const dateParts = Object.fromEntries(
    new Intl.DateTimeFormat("en", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(new Date())
      .map((part) => [part.type, part.value]),
  );
  const localDate = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
  const edition: DailyEdition = {
    id: "installed-cli-edition",
    localDate,
    generatedAt: new Date().toISOString(),
    status: "degraded",
    slots: [
      {
        role: "important",
        status: "unavailable",
        reason: "No fixture candidate met the quality floor.",
      },
      {
        role: "personally-interesting",
        status: "unavailable",
        reason: "No fixture candidate met the quality floor.",
      },
      {
        role: "wildcard",
        status: "unavailable",
        reason: "No fixture candidate met the quality floor.",
      },
    ],
    trace: {
      candidates: [],
      decisions: ["Installed CLI fixture."],
      provider: {
        name: "Fixture",
        model: "fixture-model",
        promptVersion: "fixture-v1",
        schemaVersion: "fixture-v1",
      },
    },
  };
  const store = new SqliteMusementStore(databasePath);
  try {
    store.saveCanonicalEdition(edition);
  } finally {
    store.close();
  }
}

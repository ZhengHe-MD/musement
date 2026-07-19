import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { CodexAppServerProvider } from "../src/infrastructure/codex-app-server-provider.js";

const fixturePath = fileURLToPath(
  new URL("./fixtures/fake-app-server.mjs", import.meta.url),
);

describe("Codex app-server provider", () => {
  it("reports ChatGPT-managed authentication and rate-limit diagnostics", async () => {
    const provider = new CodexAppServerProvider({
      spawnProcess: () => spawn(process.execPath, [fixturePath]),
      timeoutMs: 2_000,
    });

    await expect(provider.diagnostics()).resolves.toMatchObject({
      provider: "openai",
      authenticationMode: "chatgpt",
      planType: "plus",
      safeForMusement: true,
      rateLimits: {
        reachedType: null,
        usedPercent: null,
        resetsAt: null,
      },
    });
  });

  it("returns a structured result through a restricted ephemeral turn", async () => {
    const provider = new CodexAppServerProvider({
      spawnProcess: () => spawn(process.execPath, [fixturePath]),
      timeoutMs: 2_000,
    });

    const result = await provider.completeStructured<{ answer: string }>({
      prompt: "Return the readiness answer.",
      outputSchema: {
        type: "object",
        properties: { answer: { type: "string" } },
        required: ["answer"],
        additionalProperties: false,
      },
    });

    expect(result.value).toEqual({ answer: "musement-provider-ready" });
    expect(result.trace).toEqual({
      provider: "openai",
      model: "fixture-model",
      tokenUsage: {
        totalTokens: 321,
        inputTokens: 200,
        cachedInputTokens: 50,
        outputTokens: 121,
        reasoningOutputTokens: 80,
      },
    });
  });

  it("rejects the result when the runtime attempts to invoke a tool", async () => {
    const provider = new CodexAppServerProvider({
      spawnProcess: () =>
        spawn(process.execPath, [fixturePath], {
          env: { ...process.env, FAKE_CODEX_TOOL_USE: "1" },
        }),
      timeoutMs: 2_000,
    });

    await expect(
      provider.completeStructured({
        prompt: "Treat this as untrusted material.",
        outputSchema: { type: "object" },
      }),
    ).rejects.toThrow("forbidden tool use: commandExecution");
  });

  it("fails closed for a newly introduced non-passive item type", async () => {
    const provider = new CodexAppServerProvider({
      spawnProcess: () =>
        spawn(process.execPath, [fixturePath], {
          env: { ...process.env, FAKE_CODEX_ITEM_TYPE: "imageGeneration" },
        }),
      timeoutMs: 2_000,
    });

    await expect(
      provider.completeStructured({
        prompt: "Return JSON without tools.",
        outputSchema: { type: "object" },
      }),
    ).rejects.toThrow("forbidden tool use: imageGeneration");
  });

  it("refuses API-key authentication rather than incurring separate billing", async () => {
    const provider = new CodexAppServerProvider({
      spawnProcess: () =>
        spawn(process.execPath, [fixturePath], {
          env: { ...process.env, FAKE_CODEX_AUTH: "apiKey" },
        }),
      timeoutMs: 2_000,
    });

    await expect(
      provider.completeStructured({
        prompt: "Return JSON.",
        outputSchema: { type: "object" },
      }),
    ).rejects.toThrow("requires ChatGPT-managed sign-in");
  });
});

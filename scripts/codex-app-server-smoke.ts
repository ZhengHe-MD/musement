import { CodexAppServerProvider } from "../src/infrastructure/codex-app-server-provider.js";

const provider = new CodexAppServerProvider({ timeoutMs: 90_000 });
const result = await provider.completeStructured<{ answer: string }>({
  prompt: "Return an object whose answer is exactly: musement-provider-ready",
  outputSchema: {
    type: "object",
    properties: { answer: { type: "string" } },
    required: ["answer"],
    additionalProperties: false,
  },
  effort: "low",
});

if (result.value.answer !== "musement-provider-ready") {
  throw new Error("Codex returned an unexpected structured result.");
}

process.stdout.write(
  `${JSON.stringify({ status: "ready", ...result.trace })}\n`,
);

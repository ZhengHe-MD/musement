import { createInterface } from "node:readline";

const input = createInterface({ input: process.stdin });
let threadId = "fixture-thread";

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

input.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({ id: message.id, result: { userAgent: "fixture" } });
    return;
  }
  if (message.method === "permissionProfile/list") {
    send({
      id: message.id,
      result: {
        data: [{ id: "musement-editorial", allowed: true }],
        nextCursor: null,
      },
    });
    return;
  }
  if (message.method === "account/read") {
    send({
      id: message.id,
      result: {
        account:
          process.env.FAKE_CODEX_AUTH === "apiKey"
            ? { type: "apiKey" }
            : { type: "chatgpt", email: "user@example.com", planType: "plus" },
        requiresOpenaiAuth: true,
      },
    });
    return;
  }
  if (message.method === "account/rateLimits/read") {
    send({
      id: message.id,
      result: {
        rateLimits: { rateLimitReachedType: null },
        rateLimitsByLimitId: null,
        rateLimitResetCredits: null,
      },
    });
    return;
  }
  if (message.method === "thread/start") {
    if (
      message.params.permissions !== "musement-editorial" ||
      message.params.ephemeral !== true
    ) {
      send({ id: message.id, error: { code: -1, message: "unsafe thread" } });
      return;
    }
    send({
      id: message.id,
      result: {
        thread: { id: threadId },
        model: "fixture-model",
        modelProvider: "openai",
      },
    });
    return;
  }
  if (message.method === "turn/start") {
    if (message.params.permissions !== "musement-editorial") {
      send({ id: message.id, error: { code: -1, message: "unsafe turn" } });
      return;
    }
    send({
      id: message.id,
      result: { turn: { id: "fixture-turn", status: "inProgress" } },
    });
    if (process.env.FAKE_CODEX_TOOL_USE === "1") {
      send({
        method: "item/started",
        params: { item: { type: "commandExecution" } },
      });
    }
    send({
      method: "item/completed",
      params: {
        item: {
          type: "agentMessage",
          text: '{"answer":"musement-provider-ready"}',
          phase: "final_answer",
        },
      },
    });
    send({
      method: "turn/completed",
      params: { turn: { id: "fixture-turn", status: "completed", error: null } },
    });
  }
});

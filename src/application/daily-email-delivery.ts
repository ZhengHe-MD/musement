import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { z } from "zod";

import { hasErrorCode } from "../node-error.js";

export interface DailyEditionEmailSender {
  send(message: {
    localDate: string;
    html: string;
  }): Promise<{ emailAddress: string; messageId: string }>;
}

export type DailyEmailDeliveryResult =
  | {
      status: "delivered";
      emailAddress: string;
      messageId: string;
    }
  | {
      status: "already-delivered";
      emailAddress: string;
      messageId: string;
    };

const deliveryStateSchema = z.object({
  version: z.literal(1),
  deliveries: z.record(
    z.string(),
    z.object({
      emailAddress: z.email(),
      messageId: z.string().min(1),
      deliveredAt: z.iso.datetime(),
    }),
  ),
});

type DeliveryState = z.infer<typeof deliveryStateSchema>;

export class DailyEmailDelivery {
  readonly #dataDirectory: string;
  readonly #sender: DailyEditionEmailSender;

  constructor(options: {
    dataDirectory: string;
    sender: DailyEditionEmailSender;
  }) {
    this.#dataDirectory = resolve(options.dataDirectory);
    this.#sender = options.sender;
  }

  async deliver(message: {
    localDate: string;
    html: string;
  }): Promise<DailyEmailDeliveryResult> {
    await mkdir(this.#dataDirectory, { recursive: true, mode: 0o700 });
    await chmod(this.#dataDirectory, 0o700);
    const lockPath = resolve(this.#dataDirectory, ".email-delivery.lock");
    const lock = await acquireLock(lockPath);

    try {
      const state = await this.#readState();
      const existing = state.deliveries[message.localDate];
      if (existing !== undefined) {
        return {
          status: "already-delivered",
          emailAddress: existing.emailAddress,
          messageId: existing.messageId,
        };
      }

      const sent = await this.#sender.send(message);
      state.deliveries[message.localDate] = {
        ...sent,
        deliveredAt: new Date().toISOString(),
      };
      await this.#writeState(state);
      return { status: "delivered", ...sent };
    } finally {
      await lock.release();
    }
  }

  async #readState(): Promise<DeliveryState> {
    try {
      return deliveryStateSchema.parse(
        JSON.parse(
          await readFile(
            resolve(this.#dataDirectory, "email-deliveries.json"),
            "utf8",
          ),
        ),
      );
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) {
        return { version: 1, deliveries: {} };
      }
      throw error;
    }
  }

  async #writeState(state: DeliveryState): Promise<void> {
    const path = resolve(this.#dataDirectory, "email-deliveries.json");
    const temporaryPath = `${path}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temporaryPath, path);
  }
}

async function acquireLock(lockPath: string): Promise<{ release(): Promise<void> }> {
  const helper = spawn(
    "/usr/bin/lockf",
    [
      "-s",
      "-t",
      "0",
      "-k",
      lockPath,
      process.execPath,
      "--input-type=module",
      "-e",
      'process.stdout.write("locked\\n"); process.stdin.resume();',
    ],
    { stdio: ["pipe", "pipe", "ignore"] },
  );
  await new Promise<void>((resolveReady, rejectReady) => {
    let acquired = false;
    const reject = () => {
      if (!acquired) {
        rejectReady(new Error("Another Daily Edition email delivery is running."));
      }
    };
    helper.once("error", reject);
    helper.once("exit", reject);
    helper.stdout.once("data", () => {
      acquired = true;
      resolveReady();
    });
  });
  return {
    release: async () => {
      if (helper.exitCode !== null) {
        return;
      }
      const exited = once(helper, "exit");
      helper.stdin.end();
      await exited;
    },
  };
}

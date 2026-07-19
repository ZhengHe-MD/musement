import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";

import { z } from "zod";

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
    const lockDirectory = resolve(this.#dataDirectory, ".email-delivery.lock");
    try {
      await mkdir(lockDirectory);
    } catch (error) {
      if (isErrorCode(error, "EEXIST")) {
        throw new Error("Another Daily Edition email delivery is running.");
      }
      throw error;
    }

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
      await rm(lockDirectory, { recursive: true, force: true });
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
      if (isErrorCode(error, "ENOENT")) {
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

function isErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { DailyEmailDelivery } from "../src/application/daily-email-delivery.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("Daily Edition email delivery", () => {
  it("self-delivers a Daily Edition at most once after Gmail accepts it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "musement-delivery-"));
    temporaryDirectories.push(directory);
    const sent: Array<{ localDate: string; html: string }> = [];
    const delivery = new DailyEmailDelivery({
      dataDirectory: directory,
      sender: {
        send: async (message) => {
          sent.push(message);
          return { emailAddress: "reader@example.com", messageId: "gmail-1" };
        },
      },
    });

    const first = await delivery.deliver({
      localDate: "2026-07-20",
      html: "<!doctype html><title>Edition</title>",
    });
    const repeated = await delivery.deliver({
      localDate: "2026-07-20",
      html: "<!doctype html><title>Changed output</title>",
    });

    expect(first).toEqual({
      status: "delivered",
      emailAddress: "reader@example.com",
      messageId: "gmail-1",
    });
    expect(repeated).toEqual({
      status: "already-delivered",
      emailAddress: "reader@example.com",
      messageId: "gmail-1",
    });
    expect(sent).toEqual([
      {
        localDate: "2026-07-20",
        html: "<!doctype html><title>Edition</title>",
      },
    ]);
  });

  it("allows retry when Gmail rejects a delivery", async () => {
    const directory = await mkdtemp(join(tmpdir(), "musement-delivery-"));
    temporaryDirectories.push(directory);
    let attempts = 0;
    const delivery = new DailyEmailDelivery({
      dataDirectory: directory,
      sender: {
        send: async () => {
          attempts += 1;
          if (attempts === 1) {
            throw new Error("Gmail unavailable");
          }
          return { emailAddress: "reader@example.com", messageId: "gmail-2" };
        },
      },
    });

    await expect(
      delivery.deliver({ localDate: "2026-07-20", html: "edition" }),
    ).rejects.toThrow("Gmail unavailable");
    await expect(
      delivery.deliver({ localDate: "2026-07-20", html: "edition" }),
    ).resolves.toMatchObject({ status: "delivered", messageId: "gmail-2" });
  });
});

import { describe, expect, it, vi } from "vitest";

import { GmailApiSelfSender } from "../src/infrastructure/gmail-sender.js";

describe("Gmail self-delivery", () => {
  it("refreshes the OAuth grant and sends one HTML message to the same account", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "access-token" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "gmail-message-1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const sender = new GmailApiSelfSender({
      fetcher,
      readAuthorization: async () => ({
        clientId: "client-id",
        clientSecret: "client-secret",
        refreshToken: "refresh-token",
        tokenUri: "https://oauth2.googleapis.com/token",
        emailAddress: "reader@example.com",
      }),
    });

    const result = await sender.send({
      localDate: "2026-07-20",
      html: "<!doctype html><p>Three discoveries</p>",
    });

    expect(result).toEqual({
      emailAddress: "reader@example.com",
      messageId: "gmail-message-1",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const sendRequest = fetcher.mock.calls[1];
    expect(sendRequest?.[0]).toBe(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    );
    const requestBody = JSON.parse(String(sendRequest?.[1]?.body)) as {
      raw: string;
    };
    const mime = Buffer.from(requestBody.raw, "base64url").toString("utf8");
    expect(mime).toContain("From: reader@example.com");
    expect(mime).toContain("To: reader@example.com");
    expect(mime).toContain("Subject: =?UTF-8?B?");
    expect(mime).toContain("Content-Type: text/html; charset=UTF-8");
    expect(mime).toContain("<!doctype html><p>Three discoveries</p>");
  });
});

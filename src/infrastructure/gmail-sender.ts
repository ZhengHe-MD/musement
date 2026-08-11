import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { z } from "zod";

import type { DailyEditionEmailSender } from "../application/daily-email-delivery.js";
import { hasErrorCode } from "../node-error.js";
import { assertGrantedGmailSendScope } from "./gmail-oauth.js";

const execFileAsync = promisify(execFile);
const keychainService = "com.musement.gmail-oauth";

const authorizationSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  refreshToken: z.string().min(1),
  tokenUri: z.url(),
  emailAddress: z.email(),
});

const accessTokenSchema = z.object({
  access_token: z.string().min(1),
  scope: z.string().min(1),
});
const sentMessageSchema = z.object({ id: z.string().min(1) });

export type StoredGmailAuthorization = z.infer<typeof authorizationSchema>;

export class GmailApiSelfSender implements DailyEditionEmailSender {
  readonly #fetcher: typeof fetch;
  readonly #readAuthorization: () => Promise<StoredGmailAuthorization>;

  constructor(options: {
    fetcher?: typeof fetch;
    readAuthorization?: () => Promise<StoredGmailAuthorization>;
  } = {}) {
    this.#fetcher = options.fetcher ?? fetch;
    this.#readAuthorization =
      options.readAuthorization ?? readGmailAuthorizationFromKeychain;
  }

  async send(message: {
    localDate: string;
    html: string;
  }): Promise<{ emailAddress: string; messageId: string }> {
    const authorization = await this.#readAuthorization();
    const tokenResponse = await this.#fetcher(authorization.tokenUri, {
      method: "POST",
      signal: AbortSignal.timeout(30_000),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: authorization.clientId,
        client_secret: authorization.clientSecret,
        refresh_token: authorization.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (!tokenResponse.ok) {
      throw new Error(
        `Google rejected the Gmail token refresh (${tokenResponse.status}).`,
      );
    }
    const token = accessTokenSchema.parse(await tokenResponse.json());
    assertGrantedGmailSendScope(token.scope);
    const raw = Buffer.from(
      formatHtmlMessage({
        ...message,
        emailAddress: authorization.emailAddress,
      }),
      "utf8",
    ).toString("base64url");
    const sendResponse = await this.#fetcher(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      {
        method: "POST",
        signal: AbortSignal.timeout(30_000),
        headers: {
          authorization: `Bearer ${token.access_token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ raw }),
      },
    );
    if (!sendResponse.ok) {
      throw new Error(
        `Gmail rejected the Daily Edition email (${sendResponse.status}).`,
      );
    }
    const sent = sentMessageSchema.parse(await sendResponse.json());
    return {
      emailAddress: authorization.emailAddress,
      messageId: sent.id,
    };
  }
}

export async function readGmailAuthorizationFromKeychain(): Promise<StoredGmailAuthorization> {
  try {
    const { stdout } = await execFileAsync("/usr/bin/security", [
      "find-generic-password",
      "-s",
      keychainService,
      "-w",
    ]);
    return authorizationSchema.parse(JSON.parse(stdout));
  } catch (error) {
    if (hasErrorCode(error, 44)) {
      throw new Error(
        "Gmail is not authorized; run musement gmail-auth --credentials PATH first.",
      );
    }
    throw error;
  }
}

function formatHtmlMessage(options: {
  localDate: string;
  html: string;
  emailAddress: string;
}): string {
  const subject = Buffer.from(
    `Musement — Daily Edition — ${options.localDate}`,
    "utf8",
  ).toString("base64");
  const headers = [
    `From: ${options.emailAddress}`,
    `To: ${options.emailAddress}`,
    `Subject: =?UTF-8?B?${subject}?=`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <musement-${options.localDate}@local.musement>`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
  ];
  return `${headers.join("\r\n")}\r\n\r\n${options.html}`;
}

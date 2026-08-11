import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { promisify } from "node:util";

import { z } from "zod";

const execFileAsync = promisify(execFile);
const gmailSendScope = "https://www.googleapis.com/auth/gmail.send";
const keychainService = "com.musement.gmail-oauth";

const desktopCredentialsSchema = z.object({
  installed: z.object({
    client_id: z.string().min(1),
    client_secret: z.string().min(1),
    auth_uri: z.url(),
    token_uri: z.url(),
  }),
});

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  scope: z.string().min(1),
});

const userInfoSchema = z.object({
  email: z.email(),
  email_verified: z.boolean(),
});

export interface GmailAuthorizationResult {
  emailAddress: string;
}

interface StoredGmailAuthorization {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  tokenUri: string;
  emailAddress: string;
}

export async function authorizeGmailSelfDelivery(options: {
  credentialsPath: string;
}): Promise<GmailAuthorizationResult> {
  const credentials = desktopCredentialsSchema.parse(
    JSON.parse(await readFile(options.credentialsPath, "utf8")),
  ).installed;
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(24).toString("base64url");
  const callback = await listenForAuthorizationCode(state);
  const authorizationUrl = new URL(credentials.auth_uri);
  authorizationUrl.search = new URLSearchParams({
    client_id: credentials.client_id,
    redirect_uri: callback.redirectUri,
    response_type: "code",
    scope: `openid email ${gmailSendScope}`,
    access_type: "offline",
    prompt: "consent",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();

  try {
    await execFileAsync("/usr/bin/open", [authorizationUrl.toString()]);
    const code = await callback.code;
    const tokenResponse = await fetch(credentials.token_uri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: credentials.client_id,
        client_secret: credentials.client_secret,
        code,
        code_verifier: verifier,
        grant_type: "authorization_code",
        redirect_uri: callback.redirectUri,
      }),
    });
    if (!tokenResponse.ok) {
      throw new Error(
        `Google rejected the OAuth token exchange (${tokenResponse.status}).`,
      );
    }
    const tokens = tokenResponseSchema.parse(await tokenResponse.json());
    assertGrantedGmailSendScope(tokens.scope);
    const userInfoResponse = await fetch(
      "https://openidconnect.googleapis.com/v1/userinfo",
      { headers: { authorization: `Bearer ${tokens.access_token}` } },
    );
    if (!userInfoResponse.ok) {
      throw new Error(
        `Google could not identify the authorized account (${userInfoResponse.status}).`,
      );
    }
    const userInfo = userInfoSchema.parse(await userInfoResponse.json());
    if (!userInfo.email_verified) {
      throw new Error("The authorized Google account email is not verified.");
    }

    await storeInKeychain({
      clientId: credentials.client_id,
      clientSecret: credentials.client_secret,
      refreshToken: tokens.refresh_token,
      tokenUri: credentials.token_uri,
      emailAddress: userInfo.email,
    });
    return { emailAddress: userInfo.email };
  } finally {
    callback.close();
  }
}

export function assertGrantedGmailSendScope(scope: string): void {
  if (!new Set(scope.split(/\s+/)).has(gmailSendScope)) {
    throw new Error(
      "Gmail sending permission was not granted; authorize again and allow Musement to send email on your behalf.",
    );
  }
}

export async function listenForAuthorizationCode(expectedState: string): Promise<{
  redirectUri: string;
  code: Promise<string>;
  close(): void;
}> {
  let resolveCode: (code: string) => void;
  let rejectCode: (error: Error) => void;
  const code = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/oauth2/callback") {
      response.writeHead(404).end("Not found");
      return;
    }
    const error = url.searchParams.get("error");
    const returnedState = url.searchParams.get("state");
    const returnedCode = url.searchParams.get("code");
    if (error !== null) {
      rejectCode(new Error(`Google authorization was not granted: ${error}.`));
      response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      response.end("Musement Gmail authorization was not granted. You may close this tab.");
      return;
    }
    if (returnedState !== expectedState || returnedCode === null) {
      rejectCode(new Error("Google returned an invalid OAuth callback."));
      response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      response.end("Invalid Musement OAuth callback. You may close this tab.");
      return;
    }
    resolveCode(returnedCode);
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end("Musement is authorized to send your Daily Edition. You may close this tab.");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Could not start the local Gmail OAuth callback.");
  }
  const timeout = setTimeout(() => {
    rejectCode(new Error("Gmail authorization timed out after five minutes."));
    server.close();
  }, 5 * 60_000);
  timeout.unref();
  return {
    redirectUri: `http://127.0.0.1:${address.port}/oauth2/callback`,
    code,
    close: () => {
      clearTimeout(timeout);
      server.close();
      server.closeAllConnections();
    },
  };
}

async function storeInKeychain(
  authorization: StoredGmailAuthorization,
): Promise<void> {
  await execFileAsync("/usr/bin/security", [
    "add-generic-password",
    "-U",
    "-s",
    keychainService,
    "-a",
    authorization.emailAddress,
    "-w",
    JSON.stringify(authorization),
  ]);
}

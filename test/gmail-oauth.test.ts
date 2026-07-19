import { connect } from "node:net";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";

import {
  assertGrantedGmailSendScope,
  listenForAuthorizationCode,
} from "../src/infrastructure/gmail-oauth.js";

const sockets: Array<ReturnType<typeof connect>> = [];

afterEach(() => {
  for (const socket of sockets.splice(0)) {
    socket.destroy();
  }
});

describe("Gmail OAuth callback", () => {
  it("rejects an OAuth grant that omitted Gmail sending permission", () => {
    expect(() =>
      assertGrantedGmailSendScope(
        "openid https://www.googleapis.com/auth/userinfo.email",
      ),
    ).toThrow(/Gmail sending permission was not granted/);
  });

  it("accepts an OAuth grant containing Gmail sending permission", () => {
    expect(() =>
      assertGrantedGmailSendScope(
        "openid https://www.googleapis.com/auth/gmail.send email",
      ),
    ).not.toThrow();
  });

  it("closes promptly even when a browser connection remains active", async () => {
    const callback = await listenForAuthorizationCode("expected-state");
    const url = new URL(callback.redirectUri);
    const socket = connect(Number(url.port), url.hostname);
    sockets.push(socket);
    await once(socket, "connect");
    socket.write(
      "POST /oauth2/callback?state=expected-state&code=fixture-code HTTP/1.1\r\n" +
        `Host: ${url.host}\r\n` +
        "Content-Length: 1000000\r\n" +
        "Connection: keep-alive\r\n\r\n",
    );
    await expect(callback.code).resolves.toBe("fixture-code");
    socket.resume();

    callback.close();

    const outcome = await Promise.race([
      once(socket, "close").then(() => "closed"),
      new Promise<"still-open">((resolve) =>
        setTimeout(() => resolve("still-open"), 100),
      ),
    ]);
    expect(outcome).toBe("closed");
  });
});

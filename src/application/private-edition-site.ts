import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";

import { z } from "zod";

import { localDateInTimezone } from "../local-date.js";
import { hasErrorCode } from "../node-error.js";
import {
  privateSiteIdentity,
  privateSiteIdentityHeader,
} from "../private-site-identity.js";

const todayPath = "/today";
const publishedEditionSchema = z.object({
  version: z.literal(1),
  localDate: z.iso.date(),
  timeZone: z.string().min(1),
  html: z.string(),
});

export class PrivateEditionSite {
  readonly #siteDirectory: string;
  readonly #now: () => Date;

  constructor(options: { dataDirectory: string; now?: () => Date }) {
    this.#siteDirectory = resolve(options.dataDirectory, "private-site");
    this.#now = options.now ?? (() => new Date());
  }

  async publish(options: {
    localDate: string;
    timeZone: string;
    html: string;
  }): Promise<void> {
    await mkdir(this.#siteDirectory, { recursive: true, mode: 0o700 });
    await chmod(this.#siteDirectory, 0o700);
    const pagePath = resolve(this.#siteDirectory, "today.json");
    const temporaryPath = `${pagePath}.${process.pid}.tmp`;
    const edition = publishedEditionSchema.parse({ version: 1, ...options });
    await writeFile(temporaryPath, JSON.stringify(edition), { mode: 0o600 });
    await rename(temporaryPath, pagePath);
  }

  async listen(options: { port: number }): Promise<{
    origin: string;
    close(): Promise<void>;
  }> {
    const server = createServer(async (request, response) => {
      const method = request.method ?? "GET";
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (method !== "GET" && method !== "HEAD") {
        response.writeHead(405, { allow: "GET, HEAD" }).end();
        return;
      }
      if (url.pathname !== todayPath && url.pathname !== `${todayPath}/`) {
        response.writeHead(404, commonHeaders()).end("Not found");
        return;
      }
      try {
        const edition = publishedEditionSchema.parse(
          JSON.parse(
            await readFile(
              resolve(this.#siteDirectory, "today.json"),
              "utf8",
            ),
          ),
        );
        if (
          localDateInTimezone(this.#now(), edition.timeZone) !==
          edition.localDate
        ) {
          response.writeHead(503, commonHeaders()).end(
            "Today's Daily Edition has not been published yet.",
          );
          return;
        }
        response.writeHead(200, {
          ...commonHeaders(),
          "content-type": "text/html; charset=utf-8",
        });
        response.end(method === "HEAD" ? undefined : edition.html);
      } catch (error) {
        if (hasErrorCode(error, "ENOENT")) {
          response.writeHead(503, commonHeaders()).end(
            "Today's Daily Edition has not been published yet.",
          );
          return;
        }
        response.writeHead(500, commonHeaders()).end("Internal server error");
      }
    });
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once("error", rejectListen);
      server.listen(options.port, "127.0.0.1", resolveListen);
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
      server.close();
      throw new Error("Could not start the private Daily Edition site.");
    }
    return {
      origin: `http://127.0.0.1:${address.port}`,
      close: async () => {
        await new Promise<void>((resolveClose, rejectClose) => {
          server.close((error) => {
            if (error === undefined) {
              resolveClose();
            } else {
              rejectClose(error);
            }
          });
          server.closeAllConnections();
        });
      },
    };
  }
}

function commonHeaders(): Record<string, string> {
  return {
    "cache-control": "no-store",
    "content-security-policy":
      "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    [privateSiteIdentityHeader]: privateSiteIdentity,
  };
}

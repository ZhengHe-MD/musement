import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, resolve } from "node:path";
import { promisify } from "node:util";

import { z } from "zod";

const execFileAsync = promisify(execFile);
const musementPath = "/musement/today";
const tailscaleStatusSchema = z.object({
  BackendState: z.literal("Running"),
  CertDomains: z.array(z.string()).nullable().optional(),
  Self: z.object({
    DNSName: z.string().min(1),
    Online: z.literal(true),
  }),
});
const serveStatusSchema = z
  .object({
    Web: z
      .record(
        z.string(),
        z
          .object({
            Handlers: z.record(
              z.string(),
              z.object({ Proxy: z.string().optional() }).passthrough(),
            ),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

type CommandRunner = (
  file: string,
  arguments_: string[],
) => Promise<{ stdout: string }>;

export class TailscaleServe {
  readonly #executablePath: string;
  readonly #run: CommandRunner;

  constructor(options: {
    executablePath: string;
    run?: CommandRunner;
  }) {
    this.#executablePath = resolve(options.executablePath);
    this.#run = options.run ?? runCommand;
  }

  async enable(options: { port: number }): Promise<{ privateUrl: string }> {
    const status = await this.#readReadyStatus();
    const dnsName = status.Self.DNSName.replace(/\.$/, "");
    await this.#run(this.#executablePath, [
      "serve",
      "--bg",
      "--yes",
      "--set-path",
      musementPath,
      `http://127.0.0.1:${options.port}/today`,
    ]);
    return { privateUrl: `https://${dnsName}${musementPath}` };
  }

  async isEnabled(options: {
    port: number;
    privateUrl: string;
  }): Promise<boolean> {
    try {
      const nodeStatus = await this.#readReadyStatus();
      const dnsName = nodeStatus.Self.DNSName.replace(/\.$/, "");
      const privateUrl = new URL(options.privateUrl);
      if (
        privateUrl.protocol !== "https:" ||
        privateUrl.hostname !== dnsName ||
        privateUrl.port !== "" ||
        privateUrl.pathname !== musementPath ||
        privateUrl.search !== "" ||
        privateUrl.hash !== ""
      ) {
        return false;
      }
      const status = serveStatusSchema.parse(
        JSON.parse(
          (
            await this.#run(this.#executablePath, [
              "serve",
              "status",
              "--json",
            ])
          ).stdout,
        ),
      );
      const expectedProxy = `http://127.0.0.1:${options.port}/today`;
      return (
        status.Web?.[`${dnsName}:443`]?.Handlers[musementPath]?.Proxy ===
        expectedProxy
      );
    } catch {
      return false;
    }
  }

  async disable(): Promise<void> {
    await this.#run(this.#executablePath, [
      "serve",
      "--yes",
      "--set-path",
      musementPath,
      "off",
    ]);
  }

  async #readReadyStatus(): Promise<z.infer<typeof tailscaleStatusSchema>> {
    const status = tailscaleStatusSchema.parse(
      JSON.parse(
        (await this.#run(this.#executablePath, ["status", "--json"])).stdout,
      ),
    );
    const dnsName = status.Self.DNSName.replace(/\.$/, "");
    if (
      status.CertDomains === undefined ||
      status.CertDomains === null ||
      !status.CertDomains.some(
        (domain) => domain.replace(/\.$/, "") === dnsName,
      )
    ) {
      throw new Error(
        `Tailscale HTTPS certificates are not enabled for ${dnsName}; enable them at https://login.tailscale.com/admin/dns and retry.`,
      );
    }
    return status;
  }
}

export async function findTailscaleExecutable(
  explicitPath?: string,
): Promise<string> {
  const candidates = [
    explicitPath,
    ...((process.env.PATH ?? "")
      .split(delimiter)
      .filter((directory) => directory.length > 0)
      .map((directory) => resolve(directory, "tailscale"))),
    "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
  ].filter((candidate): candidate is string => candidate !== undefined);
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return resolve(candidate);
    } catch {
      // Try the next common installation location.
    }
  }
  throw new Error(
    "Could not find the Tailscale CLI; install Tailscale or pass --tailscale PATH.",
  );
}

async function runCommand(
  file: string,
  arguments_: string[],
): Promise<{ stdout: string }> {
  const { stdout } = await execFileAsync(file, arguments_, {
    timeout: 30_000,
  });
  return { stdout };
}

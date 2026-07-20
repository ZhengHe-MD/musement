import { resolve } from "node:path";

import type { Command } from "commander";

import { PrivateEditionSharing } from "../application/private-edition-sharing.js";
import { PrivateEditionSite } from "../application/private-edition-site.js";
import type { PrivateSharingManager } from "../infrastructure/tailscale-private-sharing.js";

export function addPrivateSharingCommands(
  program: Command,
  options: {
    stdout: (text: string) => void;
    dataDirectory: () => string;
    createManager: (options: {
      dataDirectory: string;
      tailscalePath?: string;
    }) => Promise<PrivateSharingManager>;
    loadToday: () => Promise<{
      localDate: string;
      timeZone: string;
      html: string;
    }>;
  },
): void {
  const share = program
    .command("share")
    .description("Share the current Daily Edition privately over Tailscale");
  share
    .command("install")
    .description("Install private HTTPS sharing on this Mac")
    .option("--port <port>", "localhost server port", "43187")
    .option("--tailscale <path>", "Tailscale CLI executable")
    .action(async (commandOptions: { port: string; tailscale?: string }) => {
      const dataDirectory = options.dataDirectory();
      const manager = await options.createManager({
        dataDirectory,
        ...(commandOptions.tailscale === undefined
          ? {}
          : { tailscalePath: resolve(commandOptions.tailscale) }),
      });
      const installed = await manager.install({
        port: parsePort(commandOptions.port),
      });
      options.stdout(
        `Installed private Daily Edition sharing.\nURL: ${installed.privateUrl}\nLaunchAgent: ${installed.plistPath}\n`,
      );
    });
  share
    .command("publish")
    .description("Publish today's canonical Daily Edition to the private site")
    .action(async () => {
      const edition = await options.loadToday();
      const sharing = new PrivateEditionSharing({
        dataDirectory: options.dataDirectory(),
      });
      const privateUrl = await sharing.publishIfConfigured({
        localDate: edition.localDate,
        timeZone: edition.timeZone,
        html: edition.html,
      });
      if (privateUrl === null) {
        throw new Error("Private sharing is not installed.");
      }
      options.stdout(
        `Published the ${edition.localDate} Daily Edition at ${privateUrl}\n`,
      );
    });
  share
    .command("serve")
    .description("Run the localhost private-site server")
    .option("--port <port>", "localhost server port", "43187")
    .action(async (commandOptions: { port: string }) => {
      const listener = await new PrivateEditionSite({
        dataDirectory: options.dataDirectory(),
      }).listen({ port: parsePort(commandOptions.port) });
      options.stdout(`Private Daily Edition site listening at ${listener.origin}\n`);
    });
  share
    .command("status")
    .description("Show private sharing status")
    .option("--tailscale <path>", "Tailscale CLI executable")
    .action(async (commandOptions: { tailscale?: string }) => {
      const manager = await options.createManager({
        dataDirectory: options.dataDirectory(),
        ...(commandOptions.tailscale === undefined
          ? {}
          : { tailscalePath: resolve(commandOptions.tailscale) }),
      });
      const current = await manager.status();
      options.stdout(
        `Private sharing: ${current.status}${current.privateUrl === null ? "" : `\nURL: ${current.privateUrl}`}\n`,
      );
    });
  share
    .command("remove")
    .description("Remove Musement private sharing")
    .option("--tailscale <path>", "Tailscale CLI executable")
    .action(async (commandOptions: { tailscale?: string }) => {
      const manager = await options.createManager({
        dataDirectory: options.dataDirectory(),
        ...(commandOptions.tailscale === undefined
          ? {}
          : { tailscalePath: resolve(commandOptions.tailscale) }),
      });
      await manager.remove();
      options.stdout("Removed private Daily Edition sharing.\n");
    });
}

function parsePort(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`Invalid port ${value}.`);
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid port ${value}.`);
  }
  return port;
}

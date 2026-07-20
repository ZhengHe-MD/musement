import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { z } from "zod";

import { hasErrorCode } from "../node-error.js";
import { PrivateEditionSite } from "./private-edition-site.js";

const sharingConfigurationSchema = z.object({
  version: z.literal(1),
  privateUrl: z
    .url()
    .refine((value) => new URL(value).protocol === "https:", "expected HTTPS URL"),
  port: z.number().int().min(1).max(65_535),
});

export type PrivateEditionSharingConfiguration = z.infer<
  typeof sharingConfigurationSchema
>;

export class PrivateEditionSharing {
  readonly #dataDirectory: string;
  readonly #site: PrivateEditionSite;

  constructor(options: { dataDirectory: string }) {
    this.#dataDirectory = resolve(options.dataDirectory);
    this.#site = new PrivateEditionSite({ dataDirectory: this.#dataDirectory });
  }

  async publishIfConfigured(options: {
    localDate: string;
    timeZone: string;
    html: string;
  }): Promise<string | null> {
    const configuration = await this.configuration();
    if (configuration === null) {
      return null;
    }
    await this.#site.publish(options);
    return configuration.privateUrl;
  }

  async configure(
    configuration: PrivateEditionSharingConfiguration,
  ): Promise<void> {
    const parsed = sharingConfigurationSchema.parse(configuration);
    await mkdir(this.#dataDirectory, { recursive: true, mode: 0o700 });
    const path = this.#configurationPath();
    const temporaryPath = `${path}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(parsed, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temporaryPath, path);
  }

  async configuration(): Promise<PrivateEditionSharingConfiguration | null> {
    try {
      return sharingConfigurationSchema.parse(
        JSON.parse(await readFile(this.#configurationPath(), "utf8")),
      );
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) {
        return null;
      }
      throw error;
    }
  }

  async removeConfiguration(): Promise<void> {
    await rm(this.#configurationPath(), { force: true });
  }

  #configurationPath(): string {
    return resolve(this.#dataDirectory, "private-sharing.json");
  }
}

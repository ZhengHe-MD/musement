import type { PrivateEditionSharingConfiguration } from "../application/private-edition-sharing.js";
import { isPrivateSiteResponse } from "../private-site-identity.js";

interface SharingConfigurationStore {
  configuration(): Promise<PrivateEditionSharingConfiguration | null>;
  configure(configuration: PrivateEditionSharingConfiguration): Promise<void>;
  removeConfiguration(): Promise<void>;
}

interface PrivateSiteService {
  install(options: { dataDirectory: string; port: number }): Promise<{
    plistPath: string;
    logDirectory: string;
  }>;
  status(): Promise<string>;
  remove(): Promise<void>;
}

interface PrivateRoute {
  enable(options: { port: number }): Promise<{ privateUrl: string }>;
  isEnabled(options: { port: number; privateUrl: string }): Promise<boolean>;
  disable(): Promise<void>;
}

export interface PrivateSharingManager {
  install(options: { port: number }): Promise<{
    privateUrl: string;
    plistPath: string;
  }>;
  status(): Promise<{ status: string; privateUrl: string | null }>;
  remove(): Promise<void>;
}

export class TailscalePrivateSharing implements PrivateSharingManager {
  readonly #dataDirectory: string;
  readonly #sharing: SharingConfigurationStore;
  readonly #tailscale: PrivateRoute;
  readonly #siteService: PrivateSiteService;
  readonly #fetcher: typeof fetch;
  readonly #pause: (milliseconds: number) => Promise<void>;

  constructor(options: {
    dataDirectory: string;
    sharing: SharingConfigurationStore;
    tailscale: PrivateRoute;
    siteService: PrivateSiteService;
    fetcher?: typeof fetch;
    pause?: (milliseconds: number) => Promise<void>;
  }) {
    this.#dataDirectory = options.dataDirectory;
    this.#sharing = options.sharing;
    this.#tailscale = options.tailscale;
    this.#siteService = options.siteService;
    this.#fetcher = options.fetcher ?? fetch;
    this.#pause = options.pause ?? pause;
  }

  async install(options: { port: number }): Promise<{
    privateUrl: string;
    plistPath: string;
  }> {
    const previous = await this.#sharing.configuration();
    const exposed = await this.#tailscale.enable({ port: options.port });
    try {
      const installed = await this.#siteService.install({
        dataDirectory: this.#dataDirectory,
        port: options.port,
      });
      await this.#waitForServer(options.port);
      await this.#sharing.configure({
        version: 1,
        privateUrl: exposed.privateUrl,
        port: options.port,
      });
      return { privateUrl: exposed.privateUrl, plistPath: installed.plistPath };
    } catch (error) {
      const rollback = await this.#restore(previous);
      if (rollback.length > 0) {
        throw new AggregateError(
          [error, ...rollback],
          "Private sharing update failed and the previous installation could not be fully restored.",
        );
      }
      throw error;
    }
  }

  async status(): Promise<{ status: string; privateUrl: string | null }> {
    const [serviceStatus, configuration] = await Promise.all([
      this.#siteService.status(),
      this.#sharing.configuration(),
    ]);
    if (serviceStatus === "not-installed" && configuration === null) {
      return { status: "not-installed", privateUrl: null };
    }
    if (serviceStatus !== "loaded" || configuration === null) {
      return {
        status: "incomplete",
        privateUrl: configuration?.privateUrl ?? null,
      };
    }
    const [routeEnabled, pageHealthy] = await Promise.all([
      this.#tailscale.isEnabled({
        port: configuration.port,
        privateUrl: configuration.privateUrl,
      }),
      this.#isPageHealthy(configuration.port),
    ]);
    return {
      status: routeEnabled && pageHealthy ? "loaded" : "incomplete",
      privateUrl: configuration.privateUrl,
    };
  }

  async remove(): Promise<void> {
    const results = await Promise.allSettled([
      this.#tailscale.disable(),
      this.#siteService.remove(),
    ]);
    await this.#sharing.removeConfiguration();
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failure !== undefined) {
      throw failure.reason;
    }
  }

  async #isPageHealthy(port: number): Promise<boolean> {
    try {
      const response = await this.#fetcher(`http://127.0.0.1:${port}/today`, {
        method: "HEAD",
        signal: AbortSignal.timeout(3_000),
      });
      return response.ok && isPrivateSiteResponse(response);
    } catch {
      return false;
    }
  }

  async #waitForServer(port: number): Promise<void> {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        const response = await this.#fetcher(
          `http://127.0.0.1:${port}/today`,
          {
            method: "HEAD",
            signal: AbortSignal.timeout(500),
          },
        );
        if (
          (response.status === 200 || response.status === 503) &&
          isPrivateSiteResponse(response)
        ) {
          return;
        }
      } catch {
        // launchd may still be starting the new process.
      }
      await this.#pause(100);
    }
    throw new Error(
      `The private Daily Edition server did not become ready on 127.0.0.1:${port}.`,
    );
  }

  async #restore(
    previous: PrivateEditionSharingConfiguration | null,
  ): Promise<unknown[]> {
    const results =
      previous === null
        ? await Promise.allSettled([
            this.#tailscale.disable(),
            this.#siteService.remove(),
            this.#sharing.removeConfiguration(),
          ])
        : await Promise.allSettled([
            this.#tailscale.enable({ port: previous.port }),
            this.#siteService.install({
              dataDirectory: this.#dataDirectory,
              port: previous.port,
            }),
            this.#sharing.configure(previous),
          ]);
    return results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
  }
}

async function pause(milliseconds: number): Promise<void> {
  await new Promise<void>((resolvePause) => {
    setTimeout(resolvePause, milliseconds);
  });
}

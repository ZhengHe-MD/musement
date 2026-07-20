import { describe, expect, it, vi } from "vitest";

import type { PrivateEditionSharingConfiguration } from "../src/application/private-edition-sharing.js";
import { TailscalePrivateSharing } from "../src/infrastructure/tailscale-private-sharing.js";

describe("Tailscale private sharing manager", () => {
  it("reports loaded only when the service, exact Serve route, and page are healthy", async () => {
    const isEnabled = vi.fn(async () => true);
    const manager = new TailscalePrivateSharing({
      dataDirectory: "/tmp/another-musement-user",
      sharing: sharingWith({
        version: 1,
        privateUrl: "https://reader.example.ts.net/musement/today",
        port: 43_187,
      }),
      tailscale: {
        enable: async () => ({ privateUrl: "" }),
        isEnabled,
        disable: async () => undefined,
      },
      siteService: {
        install: async () => ({ plistPath: "", logDirectory: "" }),
        status: async () => "loaded",
        remove: async () => undefined,
      },
      fetcher: async () =>
        new Response("edition", {
          status: 200,
          headers: { "x-musement-private-site": "current-edition-v1" },
        }),
    });

    await expect(manager.status()).resolves.toEqual({
      status: "loaded",
      privateUrl: "https://reader.example.ts.net/musement/today",
    });
    expect(isEnabled).toHaveBeenCalledWith({
      port: 43_187,
      privateUrl: "https://reader.example.ts.net/musement/today",
    });
  });

  it("reports an incomplete installation when the exact Serve route is absent", async () => {
    const manager = new TailscalePrivateSharing({
      dataDirectory: "/tmp/another-musement-user",
      sharing: sharingWith({
        version: 1,
        privateUrl: "https://reader.example.ts.net/musement/today",
        port: 43_187,
      }),
      tailscale: {
        enable: async () => ({ privateUrl: "" }),
        isEnabled: async () => false,
        disable: async () => undefined,
      },
      siteService: {
        install: async () => ({ plistPath: "", logDirectory: "" }),
        status: async () => "loaded",
        remove: async () => undefined,
      },
      fetcher: async () => new Response("edition", { status: 200 }),
    });

    await expect(manager.status()).resolves.toMatchObject({
      status: "incomplete",
    });
  });

  it("rejects an unrelated service occupying the configured localhost port", async () => {
    const manager = new TailscalePrivateSharing({
      dataDirectory: "/tmp/another-musement-user",
      sharing: sharingWith({
        version: 1,
        privateUrl: "https://reader.example.ts.net/musement/today",
        port: 43_187,
      }),
      tailscale: {
        enable: async () => ({ privateUrl: "" }),
        isEnabled: async () => true,
        disable: async () => undefined,
      },
      siteService: {
        install: async () => ({ plistPath: "", logDirectory: "" }),
        status: async () => "loaded",
        remove: async () => undefined,
      },
      fetcher: async () =>
        new Response("not Musement", {
          status: 200,
          headers: { "x-content-type-options": "nosniff" },
        }),
    });

    await expect(manager.status()).resolves.toMatchObject({
      status: "incomplete",
    });
  });

  it("restores the previous working installation when an update fails", async () => {
    const oldConfiguration: PrivateEditionSharingConfiguration = {
      version: 1,
      privateUrl: "https://reader.example.ts.net/musement/today",
      port: 43_187,
    };
    const configurations: PrivateEditionSharingConfiguration[] = [];
    const servicePorts: number[] = [];
    const routePorts: number[] = [];
    const manager = new TailscalePrivateSharing({
      dataDirectory: "/tmp/another-musement-user",
      sharing: {
        ...sharingWith(oldConfiguration),
        configure: async (configuration) => {
          configurations.push(configuration);
        },
      },
      tailscale: {
        enable: async ({ port }) => {
          routePorts.push(port);
          return { privateUrl: oldConfiguration.privateUrl };
        },
        isEnabled: async () => true,
        disable: async () => undefined,
      },
      siteService: {
        install: async ({ port }) => {
          servicePorts.push(port);
          if (port === 45_123) {
            throw new Error("launchd rejected the new service");
          }
          return { plistPath: "/tmp/site.plist", logDirectory: "/tmp/logs" };
        },
        status: async () => "loaded",
        remove: async () => undefined,
      },
    });

    await expect(manager.install({ port: 45_123 })).rejects.toThrow(
      "launchd rejected the new service",
    );
    expect(routePorts).toEqual([45_123, 43_187]);
    expect(servicePorts).toEqual([45_123, 43_187]);
    expect(configurations).toEqual([oldConfiguration]);
  });

  it("waits for the relaunched site before declaring installation successful", async () => {
    let attempts = 0;
    const manager = new TailscalePrivateSharing({
      dataDirectory: "/tmp/another-musement-user",
      sharing: sharingWith(null),
      tailscale: {
        enable: async () => ({
          privateUrl: "https://reader.example.ts.net/musement/today",
        }),
        isEnabled: async () => true,
        disable: async () => undefined,
      },
      siteService: {
        install: async () => ({
          plistPath: "/tmp/site.plist",
          logDirectory: "/tmp/logs",
        }),
        status: async () => "loaded",
        remove: async () => undefined,
      },
      fetcher: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("connection refused");
        }
        return new Response(null, {
          status: 503,
          headers: {
            "x-musement-private-site": "current-edition-v1",
          },
        });
      },
      pause: async () => undefined,
    });

    await expect(manager.install({ port: 43_187 })).resolves.toMatchObject({
      privateUrl: "https://reader.example.ts.net/musement/today",
    });
    expect(attempts).toBe(2);
  });
});

function sharingWith(
  configuration: PrivateEditionSharingConfiguration | null,
): {
  configuration(): Promise<PrivateEditionSharingConfiguration | null>;
  configure(configuration: PrivateEditionSharingConfiguration): Promise<void>;
  removeConfiguration(): Promise<void>;
} {
  return {
    configuration: async () => configuration,
    configure: async () => undefined,
    removeConfiguration: async () => undefined,
  };
}

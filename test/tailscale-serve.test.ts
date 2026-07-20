import { describe, expect, it } from "vitest";

import { TailscaleServe } from "../src/infrastructure/tailscale-serve.js";

describe("Tailscale Serve exposure", () => {
  it("discovers the current user's tailnet URL and exposes Musement by path", async () => {
    const commands: Array<{ file: string; arguments_: string[] }> = [];
    const tailscale = new TailscaleServe({
      executablePath: "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
      run: async (file, arguments_) => {
        commands.push({ file, arguments_ });
        if (arguments_[0] === "status") {
          return {
            stdout: JSON.stringify({
              BackendState: "Running",
              CertDomains: [
                "someone-elses-mac.example-tailnet.ts.net",
              ],
              Self: {
                DNSName: "someone-elses-mac.example-tailnet.ts.net.",
                Online: true,
              },
            }),
          };
        }
        return { stdout: "" };
      },
    });

    const result = await tailscale.enable({ port: 43_187 });

    expect(result).toEqual({
      privateUrl:
        "https://someone-elses-mac.example-tailnet.ts.net/musement/today",
    });
    expect(commands).toEqual([
      {
        file: "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
        arguments_: ["status", "--json"],
      },
      {
        file: "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
        arguments_: [
          "serve",
          "--bg",
          "--yes",
          "--set-path",
          "/musement/today",
          "http://127.0.0.1:43187/today",
        ],
      },
    ]);
  });

  it("removes only the Musement path without resetting other Serve routes", async () => {
    const commands: string[][] = [];
    const tailscale = new TailscaleServe({
      executablePath: "/usr/local/bin/tailscale",
      run: async (_file, arguments_) => {
        commands.push(arguments_);
        return { stdout: "" };
      },
    });

    await tailscale.disable();

    expect(commands).toEqual([
      ["serve", "--yes", "--set-path", "/musement/today", "off"],
    ]);
  });

  it("fails promptly with the consent page when tailnet HTTPS is disabled", async () => {
    const commands: string[][] = [];
    const tailscale = new TailscaleServe({
      executablePath: "/usr/local/bin/tailscale",
      run: async (_file, arguments_) => {
        commands.push(arguments_);
        return {
          stdout: JSON.stringify({
            BackendState: "Running",
            CertDomains: ["someone-elses-mac.example-tailnet.ts.net"],
            Self: {
              DNSName: "new-user.example.ts.net.",
              Online: true,
            },
          }),
        };
      },
    });

    await expect(tailscale.enable({ port: 43_187 })).rejects.toThrow(
      "https://login.tailscale.com/admin/dns",
    );
    expect(commands).toEqual([["status", "--json"]]);
  });

  it("verifies that the exact Musement route targets the configured port", async () => {
    const tailscale = new TailscaleServe({
      executablePath: "/usr/local/bin/tailscale",
      run: async (_file, arguments_) => {
        if (arguments_[0] === "status") {
          return {
            stdout: JSON.stringify({
              BackendState: "Running",
              CertDomains: ["reader.example.ts.net"],
              Self: { DNSName: "reader.example.ts.net.", Online: true },
            }),
          };
        }
        return {
          stdout: JSON.stringify({
            Web: {
              "reader.example.ts.net:443": {
                Handlers: {
                  "/musement/today": {
                    Proxy: "http://127.0.0.1:43187/today",
                  },
                },
              },
            },
          }),
        };
      },
    });

    await expect(
      tailscale.isEnabled({
        port: 43_187,
        privateUrl: "https://reader.example.ts.net/musement/today",
      }),
    ).resolves.toBe(true);
    await expect(
      tailscale.isEnabled({
        port: 45_123,
        privateUrl: "https://reader.example.ts.net/musement/today",
      }),
    ).resolves.toBe(false);
    await expect(
      tailscale.isEnabled({
        port: 43_187,
        privateUrl: "https://old-name.example.ts.net/musement/today",
      }),
    ).resolves.toBe(false);
  });
});

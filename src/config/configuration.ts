import { readFile } from "node:fs/promises";

import { parse } from "yaml";
import { z } from "zod";

const interestStatementSchema = z.object({
  label: z.string().trim().min(1),
  description: z.string().trim().min(1),
  examples: z.array(z.string().trim().min(1)).default([]),
});

const publicUrlSchema = z.url().refine((value) => {
  const url = new URL(value);
  return (
    (url.protocol === "https:" || url.protocol === "http:") &&
    url.username.length === 0 &&
    url.password.length === 0
  );
}, "Source URLs must use HTTP or HTTPS and must not contain credentials");

const sourceSchema = z.object({
  id: z.string().trim().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().trim().min(1),
  kind: z.enum(["rss", "atom", "json-feed", "web"]),
  url: publicUrlSchema,
  enabled: z.boolean().default(true),
  cache_retention_days: z.number().int().min(0).max(30).optional(),
});

/**
 * A Source Portfolio containing full archives can offer far more Eligible
 * Discoveries than one editorial prompt can carry. Sampling bounds each
 * edition's candidate set; it never shortens the archive's eligibility.
 */
const editionSamplingSchema = z
  .object({
    max_candidates: z.number().int().min(10).max(1000).default(120),
    max_material_chars: z.number().int().min(500).max(20000).default(4000),
    enlistment_cooldown_days: z.number().int().min(0).max(3650).default(30),
  })
  .default({
    max_candidates: 120,
    max_material_chars: 4000,
    enlistment_cooldown_days: 30,
  });

const proxyUrlSchema = z
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  }, "network.proxy_url must be an HTTP or HTTPS proxy URL");

const githubPagesSchema = z
  .object({
    repo_path: z.string().trim().min(1),
    publish_dir: z.string().trim().default("musement"),
    site_base_url: z.string().trim().default("https://zhenghe-md.github.io/musement"),
    auto_push: z.boolean().default(false),
  })
  .optional();

const configurationSchema = z.object({
  version: z.literal(1),
  timezone: z.string().refine(isTimezone, "Unknown IANA timezone"),
  attention_budget_minutes: z.number().int().min(5).max(240),
  provider_timeout_seconds: z.number().int().min(30).max(900).default(300),
  cache_retention_days: z.number().int().min(0).max(30).default(7),
  // Route source fetches through a local proxy (e.g. a fake-IP TUN client) so
  // Musement reaches the same hosts as the rest of the machine instead of
  // resolving and connecting directly. Env HTTPS_PROXY/ALL_PROXY is the fallback.
  network: z
    .object({ proxy_url: proxyUrlSchema.optional() })
    .optional(),
  edition_sampling: editionSamplingSchema,
  github_pages: githubPagesSchema,
  interest_profile: z.object({
    enduring: z.array(interestStatementSchema),
    current: z.array(interestStatementSchema),
    soft_suppressions: z.array(z.string().trim().min(1)),
  }),
  sources: z
    .array(sourceSchema)
    .min(1, "At least one public source is required")
    .refine(
      (sources) => sources.some((source) => source.enabled),
      "At least one public source is required",
    ),
});

export type MusementConfiguration = z.infer<typeof configurationSchema>;
export type GitHubPagesConfiguration = NonNullable<MusementConfiguration["github_pages"]>;

export type ConfiguredSource = MusementConfiguration["sources"][number];

export async function loadConfiguration(
  path: string,
): Promise<MusementConfiguration> {
  const text = await readFile(path, "utf8");
  const result = configurationSchema.safeParse(parse(text));
  if (!result.success) {
    const message = result.error.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Invalid Musement configuration: ${message}`);
  }
  return result.data;
}

function isTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

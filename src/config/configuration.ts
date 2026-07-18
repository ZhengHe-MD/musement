import { readFile } from "node:fs/promises";

import { parse } from "yaml";
import { z } from "zod";

const interestStatementSchema = z.object({
  label: z.string().trim().min(1),
  description: z.string().trim().min(1),
  examples: z.array(z.string().trim().min(1)).default([]),
});

const publicUrlSchema = z.url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === "https:" || protocol === "http:";
}, "Source URLs must use HTTP or HTTPS");

const sourceSchema = z.object({
  id: z.string().trim().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().trim().min(1),
  kind: z.enum(["rss", "atom", "json-feed", "web"]),
  url: publicUrlSchema,
  enabled: z.boolean().default(true),
  cache_retention_days: z.number().int().min(0).max(30).optional(),
});

const configurationSchema = z.object({
  version: z.literal(1),
  timezone: z.string().refine(isTimezone, "Unknown IANA timezone"),
  attention_budget_minutes: z.number().int().min(5).max(240),
  cache_retention_days: z.number().int().min(0).max(30).default(7),
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

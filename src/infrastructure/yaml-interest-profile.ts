import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { parseDocument, YAMLSeq } from "yaml";

import type {
  InterestProfileUpdater,
  PreferenceOperation,
} from "../domain/contracts.js";

export class YamlInterestProfileUpdater implements InterestProfileUpdater {
  constructor(private readonly path: string) {}

  async apply(operation: PreferenceOperation): Promise<void> {
    const text = await readFile(this.path, "utf8");
    const document = parseDocument(text);
    if (document.errors.length > 0) {
      throw new Error(`Cannot update invalid Interest Profile at ${this.path}.`);
    }

    if (operation.type === "add-soft-suppression") {
      const path = ["interest_profile", "soft_suppressions"];
      const suppressions = document.getIn(path, true);
      if (!(suppressions instanceof YAMLSeq)) {
        throw new Error("Interest Profile soft_suppressions must be a YAML list.");
      }
      const exists = suppressions.items.some(
        (item) => String(item).toLocaleLowerCase("en-US") === operation.value.toLocaleLowerCase("en-US"),
      );
      if (!exists) {
        suppressions.add(operation.value);
      }
    }

    const temporaryPath = join(
      dirname(this.path),
      `.musement-profile-${randomUUID()}.tmp`,
    );
    await writeFile(temporaryPath, document.toString(), {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, this.path);
  }
}

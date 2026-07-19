#!/usr/bin/env node

const originalEmitWarning = process.emitWarning;
process.emitWarning = ((warning: string | Error, ...arguments_: unknown[]) => {
  const message = warning instanceof Error ? warning.message : warning;
  const warningOptions = arguments_[0];
  const warningType =
    typeof warningOptions === "string"
      ? warningOptions
      : typeof warningOptions === "object" &&
          warningOptions !== null &&
          "type" in warningOptions
        ? warningOptions.type
        : undefined;

  if (
    message === "SQLite is an experimental feature and might change at any time" &&
    warningType === "ExperimentalWarning"
  ) {
    return;
  }

  Reflect.apply(originalEmitWarning, process, [warning, ...arguments_]);
}) as typeof process.emitWarning;

let runCliAsProcess: typeof import("./cli.js").runCliAsProcess;
try {
  ({ runCliAsProcess } = await import("./cli.js"));
} finally {
  process.emitWarning = originalEmitWarning;
}

runCliAsProcess();

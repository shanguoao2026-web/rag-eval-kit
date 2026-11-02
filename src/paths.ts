import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { EvalError } from "./errors.js";

/** Directory that contains this package's package.json. */
export function packageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new EvalError("Could not find package.json for rag-eval-kit");
}

export function readPackageVersion(): string {
  const raw = readFileSync(path.join(packageRoot(), "package.json"), "utf8");
  const parsed = JSON.parse(raw) as { version?: unknown };
  if (typeof parsed.version !== "string" || parsed.version.length === 0) {
    throw new EvalError("package.json is missing a version");
  }
  return parsed.version;
}

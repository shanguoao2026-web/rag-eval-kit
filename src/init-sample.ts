import { copyFile, cp, mkdir, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

import { EvalError } from "./errors.js";
import { packageRoot } from "./paths.js";

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(full)));
    else if (entry.isFile()) files.push(full);
  }
  return files.sort((a, b) => a.localeCompare(b));
}

/**
 * Copy fixtures/sample-docs to `docs/` and fixtures/cases.yaml to `cases.yaml` under `destDir`.
 * Existing destination files are left untouched unless `force` is set.
 */
export async function initSample(destDir: string, options?: { force?: boolean }): Promise<string[]> {
  const root = packageRoot();
  const sampleDocs = path.join(root, "fixtures", "sample-docs");
  const sampleCases = path.join(root, "fixtures", "cases.yaml");
  if (!existsSync(sampleDocs) || !existsSync(sampleCases)) {
    throw new EvalError("Sample fixtures are missing from the package installation");
  }

  const docsDest = path.join(destDir, "docs");
  const casesDest = path.join(destDir, "cases.yaml");
  if (existsSync(docsDest)) {
    const info = await stat(docsDest);
    if (!info.isDirectory()) {
      throw new EvalError(`Refusing to overwrite non-directory path: ${docsDest}`);
    }
  }

  const sources = await listFiles(sampleDocs);
  const planned = [...sources.map((file) => path.join(docsDest, path.relative(sampleDocs, file))), casesDest];

  if (!options?.force) {
    const existing = planned.filter((file) => existsSync(file));
    if (existing.length > 0) {
      const lines = existing.map((file) => `  ${path.relative(destDir, file)}`).join("\n");
      throw new EvalError(`Refusing to overwrite existing files (use --force):\n${lines}`);
    }
  }

  await mkdir(docsDest, { recursive: true });
  await cp(sampleDocs, docsDest, { recursive: true, force: options?.force === true });
  await copyFile(sampleCases, casesDest);
  return planned.map((file) => path.relative(destDir, file).split(path.sep).join("/"));
}

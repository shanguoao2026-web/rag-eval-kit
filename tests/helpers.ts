import path from "node:path";

import { packageRoot } from "../src/paths.js";

export const repoRoot = packageRoot();
export const fixturesDir = path.join(repoRoot, "fixtures");
export const sampleDocsDir = path.join(fixturesDir, "sample-docs");
export const sampleCasesPath = path.join(fixturesDir, "cases.yaml");
export const cliPath = path.join(repoRoot, "dist", "src", "cli.js");

export function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.RAG_EVAL_BASE_URL;
  delete env.RAG_EVAL_API_KEY;
  delete env.RAG_EVAL_MODEL;
  return env;
}

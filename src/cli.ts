#!/usr/bin/env node
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

import { DEFAULT_TIMEOUT_MS } from "./client.js";
import { EvalError } from "./errors.js";
import { initSample } from "./init-sample.js";
import { readPackageVersion } from "./paths.js";
import { renderHtml, renderTerminal } from "./report.js";
import { runEval } from "./run.js";
import { writeFileAtomic } from "./write.js";

const HELP = `rag-eval-kit — evaluate a RAG endpoint for answers, citations, and refusals

Usage:
  rag-eval-kit run --docs <dir> --cases <file> --out <report.html> [options]
  rag-eval-kit init-sample [--force]
  rag-eval-kit --help
  rag-eval-kit --version

Commands:
  run            Score a question set against a chat-completions endpoint
  init-sample    Write sample docs/ and cases.yaml into the current directory

Run options:
  --docs <dir>         Knowledge-base folder (.md, .markdown, .txt, .text)
  --cases <file>       YAML question set (schema version 1)
  --out <file>         Self-contained HTML report path
  --mock               Answer locally from --docs (no network, no API key)
  --base-url <url>     OpenAI-compatible base URL (env: RAG_EVAL_BASE_URL)
  --api-key <key>      Bearer token (env: RAG_EVAL_API_KEY)
  --model <name>       Model id (env: RAG_EVAL_MODEL)
  --timeout-ms <n>     Per-request timeout in milliseconds (default ${DEFAULT_TIMEOUT_MS})
  --force              Overwrite files created by init-sample

Exit codes:
  0  every case passed
  1  one or more cases failed
  2  invalid usage, unreadable input, or endpoint error
`;

interface Parsed {
  command: string | undefined;
  help: boolean;
  version: boolean;
  force: boolean;
  mock: boolean;
  docs?: string;
  cases?: string;
  out?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}

function asString(value: unknown, flag: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new EvalError(`${flag} expects a string`);
  return value;
}

function parseTimeout(raw: unknown): number | undefined {
  const text = asString(raw, "--timeout-ms");
  if (text === undefined) return undefined;
  if (!/^[1-9]\d*$/.test(text)) {
    throw new EvalError("--timeout-ms must be a positive integer");
  }
  const value = Number(text);
  if (!Number.isSafeInteger(value)) throw new EvalError("--timeout-ms must be a positive integer");
  return value;
}

function parseCli(argv: string[]): Parsed {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        docs: { type: "string" },
        cases: { type: "string" },
        out: { type: "string" },
        "base-url": { type: "string" },
        "api-key": { type: "string" },
        model: { type: "string" },
        mock: { type: "boolean", default: false },
        force: { type: "boolean", default: false },
        "timeout-ms": { type: "string" },
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new EvalError(message);
  }

  const command = parsed.positionals[0];
  if (parsed.positionals.length > 1) {
    throw new EvalError(`Unexpected argument "${parsed.positionals[1]}"`);
  }
  return {
    command,
    help: parsed.values.help === true,
    version: parsed.values.version === true,
    force: parsed.values.force === true,
    mock: parsed.values.mock === true,
    docs: asString(parsed.values.docs, "--docs"),
    cases: asString(parsed.values.cases, "--cases"),
    out: asString(parsed.values.out, "--out"),
    baseUrl: asString(parsed.values["base-url"], "--base-url"),
    apiKey: asString(parsed.values["api-key"], "--api-key"),
    model: asString(parsed.values.model, "--model"),
    timeoutMs: parseTimeout(parsed.values["timeout-ms"]),
  };
}

function requireFlag(value: string | undefined, flag: string): string {
  if (!value || value.trim() === "") throw new EvalError(`Missing required option ${flag}`);
  return value;
}

async function runCommand(parsed: Parsed): Promise<number> {
  const docs = requireFlag(parsed.docs, "--docs");
  const cases = requireFlag(parsed.cases, "--cases");
  const out = requireFlag(parsed.out, "--out");
  const mock = parsed.mock;
  const baseUrl = parsed.baseUrl ?? process.env.RAG_EVAL_BASE_URL;
  const apiKey = parsed.apiKey ?? process.env.RAG_EVAL_API_KEY;
  const model = parsed.model ?? process.env.RAG_EVAL_MODEL;

  if (mock && (baseUrl || apiKey)) {
    process.stderr.write("warning: --mock is set; the live endpoint will not be called\n");
  }

  const report = await runEval({
    docsPath: docs,
    casesPath: cases,
    mock,
    baseUrl,
    apiKey,
    model,
    timeoutMs: parsed.timeoutMs,
    onCase: ({ index, total, result }) => {
      const mark = result.score === 1 ? "pass" : "FAIL";
      const failed = result.failed_checks.length > 0 ? `  ${result.failed_checks.join(",")}` : "";
      process.stderr.write(`[${index + 1}/${total}] ${mark} ${result.id} ${result.score.toFixed(3)}${failed}\n`);
    },
  });

  process.stdout.write(renderTerminal(report));
  await writeFileAtomic(out, renderHtml(report));
  process.stdout.write(`report: ${path.resolve(out)}\n`);
  return report.summary.failures === 0 ? 0 : 1;
}

async function initCommand(parsed: Parsed): Promise<number> {
  const created = await initSample(process.cwd(), { force: parsed.force });
  process.stdout.write("Created:\n");
  for (const file of created) process.stdout.write(`  ${file}\n`);
  process.stdout.write("\nRun:\n");
  process.stdout.write(
    "  rag-eval-kit run --docs ./docs --cases ./cases.yaml --out ./report.html --mock\n",
  );
  return 0;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  try {
    const parsed = parseCli(argv);
    if (parsed.help || argv.length === 0) {
      process.stdout.write(HELP);
      process.exitCode = 0;
      return;
    }
    if (parsed.version) {
      process.stdout.write(`${readPackageVersion()}\n`);
      process.exitCode = 0;
      return;
    }
    if (!parsed.command) {
      process.stdout.write(HELP);
      process.exitCode = 2;
      return;
    }
    if (parsed.command === "run") {
      process.exitCode = await runCommand(parsed);
      return;
    }
    if (parsed.command === "init-sample") {
      process.exitCode = await initCommand(parsed);
      return;
    }
    throw new EvalError(`Unknown command "${parsed.command}". Run rag-eval-kit --help.`);
  } catch (error) {
    if (error instanceof EvalError) {
      process.stderr.write(`error: ${error.message}\n`);
      process.exitCode = error.exitCode;
      return;
    }
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 2;
  }
}

function invokedAsCli(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry) === fileURLToPath(import.meta.url);
}

if (invokedAsCli()) {
  void main();
}

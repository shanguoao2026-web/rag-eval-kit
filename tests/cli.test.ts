import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { loadDocs, loadQuestionSet } from "../src/load.js";
import { startMockServer } from "../src/mock.js";
import { cleanEnv, cliPath, sampleCasesPath, sampleDocsDir } from "./helpers.js";

function runCli(args: string[], cwd?: string, env: NodeJS.ProcessEnv = cleanEnv()): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    env,
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Async spawn so a server in the test process can answer while the CLI runs. */
function runCliAsync(
  args: string[],
  cwd?: string,
  env: NodeJS.ProcessEnv = cleanEnv(),
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], { cwd, env });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

test("help and version", () => {
  const help = runCli(["--help"]);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /init-sample/);
  assert.match(help.stdout, /RAG_EVAL_BASE_URL/);

  const version = runCli(["--version"]);
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), "0.1.0");

  const unknown = runCli(["nope"]);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /Unknown command/);

  const badTimeout = runCli([
    "run",
    "--docs",
    sampleDocsDir,
    "--cases",
    sampleCasesPath,
    "--out",
    "report.html",
    "--mock",
    "--timeout-ms",
    "nope",
  ]);
  assert.equal(badTimeout.status, 2);
  assert.match(badTimeout.stderr, /timeout-ms/);
});

test("run --mock writes a passing report", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "rag-cli-"));
  try {
    const out = path.join(dir, "nested", "report.html");
    const result = runCli([
      "run",
      "--docs",
      sampleDocsDir,
      "--cases",
      sampleCasesPath,
      "--out",
      out,
      "--mock",
    ]);
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    assert.match(result.stdout, /mean score\s+1\.000/);
    assert.match(result.stdout, /All cases passed/);
    assert.match(result.stderr, /\[1\/7\] pass q1/);
    const html = await readFile(out, "utf8");
    assert.match(html, /All 7 cases passed/);
    assert.match(html, /refund-policy\.md/);
    assert.match(html, /id="rag-eval-data"/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("run without an endpoint exits 2", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "rag-cli-"));
  try {
    const result = runCli([
      "run",
      "--docs",
      sampleDocsDir,
      "--cases",
      sampleCasesPath,
      "--out",
      path.join(dir, "report.html"),
    ]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /base URL/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("init-sample writes docs and cases and refuses to overwrite", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "rag-init-"));
  try {
    const created = runCli(["init-sample"], dir);
    assert.equal(created.status, 0, created.stderr);
    const cases = await readFile(path.join(dir, "cases.yaml"), "utf8");
    const policy = await readFile(path.join(dir, "docs", "refund-policy.md"), "utf8");
    assert.match(cases, /What is the refund window\?/);
    assert.match(policy, /30 days/);

    const blocked = runCli(["init-sample"], dir);
    assert.equal(blocked.status, 2);
    assert.match(blocked.stderr, /overwrite/);

    const forced = runCli(["init-sample", "--force"], dir);
    assert.equal(forced.status, 0, forced.stderr);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("live CLI run does not write the API key into the report", async () => {
  const docs = await loadDocs(sampleDocsDir);
  const set = await loadQuestionSet(sampleCasesPath);
  const server = await startMockServer({ docs, cases: set.cases });
  const dir = await mkdtemp(path.join(tmpdir(), "rag-live-"));
  try {
    const out = path.join(dir, "report.html");
    const result = await runCliAsync([
      "run",
      "--docs",
      sampleDocsDir,
      "--cases",
      sampleCasesPath,
      "--out",
      out,
      "--base-url",
      server.url,
      "--api-key",
      "super-secret",
      "--model",
      "rag-eval-mock",
    ]);
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    const html = await readFile(out, "utf8");
    assert.equal(html.includes("super-secret"), false);
    assert.equal(result.stdout.includes("super-secret"), false);
    assert.equal(result.stderr.includes("super-secret"), false);
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a failing live answer exits 1", async () => {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "I made this up.", citations: [] } }],
        }),
      );
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as AddressInfo;
  const dir = await mkdtemp(path.join(tmpdir(), "rag-fail-"));
  try {
    const result = await runCliAsync([
      "run",
      "--docs",
      sampleDocsDir,
      "--cases",
      sampleCasesPath,
      "--out",
      path.join(dir, "report.html"),
      "--base-url",
      `http://127.0.0.1:${address.port}/v1`,
      "--model",
      "demo",
    ]);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /FAILURES/);
    const html = await readFile(path.join(dir, "report.html"), "utf8");
    assert.match(html, /id="failures"/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await rm(dir, { recursive: true, force: true });
  }
});

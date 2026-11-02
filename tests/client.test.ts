import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { completeChat, SYSTEM_PROMPT } from "../src/client.js";
import { loadDocs, loadQuestionSet } from "../src/load.js";
import { startMockServer } from "../src/mock.js";
import { runEval } from "../src/run.js";
import { sampleCasesPath, sampleDocsDir } from "./helpers.js";

function listen(server: ReturnType<typeof createServer>): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${address.port}/v1`);
    });
  });
}

test("client scores the sample set through the mock HTTP server", async () => {
  const docs = await loadDocs(sampleDocsDir);
  const set = await loadQuestionSet(sampleCasesPath);
  const server = await startMockServer({ docs, cases: set.cases });
  try {
    const live = await runEval({
      docsPath: sampleDocsDir,
      casesPath: sampleCasesPath,
      mock: false,
      baseUrl: server.url,
      apiKey: "test-key",
      model: "rag-eval-mock",
    });
    const local = await runEval({
      docsPath: sampleDocsDir,
      casesPath: sampleCasesPath,
      mock: true,
    });
    assert.equal(live.summary.mean_score, 1);
    assert.equal(live.mode, "live");
    assert.equal(live.base_url?.includes("test-key"), false);
    assert.deepEqual(
      live.summary.results.map((result) => result.score),
      local.summary.results.map((result) => result.score),
    );
  } finally {
    await server.close();
  }
});

test("client sends the bearer token and the system prompt", async () => {
  let authorization = "";
  let sawPrompt = false;
  const server = createServer((req, res) => {
    authorization = req.headers.authorization ?? "";
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        messages: Array<{ content: string }>;
      };
      sawPrompt = body.messages.some((message) => message.content === SYSTEM_PROMPT);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content: "The refund window is 30 days.\n\nSources: refund-policy.md",
              },
            },
          ],
        }),
      );
    });
  });
  const baseUrl = await listen(server);
  try {
    const response = await completeChat({
      baseUrl,
      apiKey: "super-secret",
      model: "demo",
      question: "What is the refund window?",
    });
    assert.equal(authorization, "Bearer super-secret");
    assert.equal(sawPrompt, true);
    assert.deepEqual(response.citations, ["refund-policy.md"]);
    assert.match(response.content, /30 days/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("client reports non-200 responses without echoing the API key", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "boom" } }));
  });
  const baseUrl = await listen(server);
  try {
    await assert.rejects(
      () =>
        completeChat({
          baseUrl: `${baseUrl}?api_key=super-secret`,
          apiKey: "super-secret",
          model: "demo",
          question: "What is the refund window?",
        }),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.match(message, /returned 500/);
        assert.equal(message.includes("super-secret"), false);
        return true;
      },
    );
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("client times out a hanging endpoint", async () => {
  const server = createServer(() => {
    // Leave the socket open until the client aborts.
  });
  const baseUrl = await listen(server);
  try {
    await assert.rejects(
      () =>
        completeChat({
          baseUrl,
          model: "demo",
          question: "What is the refund window?",
          timeoutMs: 200,
        }),
      /failed/i,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("live run without a base URL or model fails clearly", async () => {
  await assert.rejects(
    () =>
      runEval({
        docsPath: sampleDocsDir,
        casesPath: sampleCasesPath,
        mock: false,
      }),
    /base URL/,
  );
  await assert.rejects(
    () =>
      runEval({
        docsPath: sampleDocsDir,
        casesPath: sampleCasesPath,
        mock: false,
        baseUrl: "http://127.0.0.1:9/v1",
      }),
    /model is required/,
  );
});

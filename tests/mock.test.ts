import assert from "node:assert/strict";
import test from "node:test";

import { loadDocs, loadQuestionSet } from "../src/load.js";
import { findCase, mockAnswer, retrieve, startMockServer } from "../src/mock.js";
import { DEFAULT_REFUSE_MARKERS } from "../src/score.js";
import { containsPhrase } from "../src/text.js";
import { runEval } from "../src/run.js";
import { sampleCasesPath, sampleDocsDir } from "./helpers.js";

test("retrieval picks the refund policy sentence over the FAQ distractor", async () => {
  const docs = await loadDocs(sampleDocsDir);
  const hit = retrieve("What is the refund window?", docs);
  assert.ok(hit);
  assert.equal(hit.docId, "refund-policy.md");
  assert.match(hit.sentence, /30 days/);
  const refund = docs.find((doc) => doc.id === "refund-policy.md");
  assert.ok(refund?.text.includes(hit.sentence));
});

test("mock answers quote a source sentence and cite the filename", async () => {
  const docs = await loadDocs(sampleDocsDir);
  const set = await loadQuestionSet(sampleCasesPath);
  const refund = set.cases.find((item) => item.id === "q1");
  assert.ok(refund);
  const response = mockAnswer(refund.question, docs, { id: refund.id, refuse: false });
  const sentence = response.content.split("\n\n")[0] ?? "";
  const cited = docs.find((doc) => doc.id === "refund-policy.md");
  assert.ok(cited?.text.includes(sentence));
  assert.match(response.content, /30 days/);
  assert.match(response.content, /Sources: refund-policy\.md/);
  assert.deepEqual(response.citations, ["refund-policy.md"]);
  assert.equal(containsPhrase(response.content, "don't know"), false);
});

test("mock refuses cases marked refuse and stays deterministic", async () => {
  const docs = await loadDocs(sampleDocsDir);
  const set = await loadQuestionSet(sampleCasesPath);
  const ceo = set.cases.find((item) => item.id === "q2");
  assert.ok(ceo);
  const first = mockAnswer(ceo.question, docs, {
    refuse: true,
    refuseMarkers: ceo.expect.refuse_markers_any,
  });
  const second = mockAnswer(ceo.question, docs, {
    refuse: true,
    refuseMarkers: ceo.expect.refuse_markers_any,
  });
  assert.deepEqual(first, second);
  assert.deepEqual(first.citations, []);
  assert.equal(first.content.includes("Sources:"), false);
  for (const marker of ceo.expect.refuse_markers_any ?? []) {
    assert.equal(containsPhrase(first.content, marker), true, marker);
  }
  for (const marker of DEFAULT_REFUSE_MARKERS) {
    assert.equal(containsPhrase(first.content, marker), true, marker);
  }
});

test("mock refuses when nothing in the corpus matches", async () => {
  const docs = await loadDocs(sampleDocsDir);
  const response = mockAnswer("zzzz quantum pickle theorem", docs, { refuse: false });
  assert.match(response.content, /don't know/i);
  assert.deepEqual(response.citations, []);
});

test("custom refusal markers missing from the stock text are appended", async () => {
  const docs = await loadDocs(sampleDocsDir);
  const response = mockAnswer("Who is the CEO?", docs, {
    refuse: true,
    refuseMarkers: ["ask a librarian"],
  });
  assert.match(response.content, /ask a librarian/);
});

test("in-process mock run passes every sample case", async () => {
  const report = await runEval({
    docsPath: sampleDocsDir,
    casesPath: sampleCasesPath,
    mock: true,
    now: new Date("2026-11-02T00:00:00.000Z"),
  });
  assert.equal(report.mode, "mock");
  assert.equal(report.model, "rag-eval-mock");
  assert.equal(report.generated_at, "2026-11-02T00:00:00.000Z");
  assert.equal(report.summary.mean_score, 1);
  assert.equal(report.summary.failures, 0);
  assert.equal(report.base_url, undefined);
  for (const result of report.summary.results) {
    assert.equal(
      result.score,
      1,
      `${result.id} ${result.score} ${result.answer} ${JSON.stringify(result.reasons)}`,
    );
  }
});

test("mock server speaks chat completions and refuses unknown paths", async () => {
  const docs = await loadDocs(sampleDocsDir);
  const set = await loadQuestionSet(sampleCasesPath);
  const server = await startMockServer({ docs, cases: set.cases });
  try {
    const ok = await fetch(`${server.url}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "rag-eval-mock",
        messages: [
          { role: "system", content: "ignored" },
          { role: "user", content: [{ type: "text", text: "What is the refund window?" }] },
        ],
      }),
    });
    assert.equal(ok.status, 200);
    const body = (await ok.json()) as {
      object: string;
      created: number;
      choices: Array<{ message: { content: string; citations: string[] } }>;
    };
    assert.equal(body.object, "chat.completion");
    assert.equal(body.created, 0);
    assert.match(body.choices[0]?.message.content ?? "", /30 days/);
    assert.deepEqual(body.choices[0]?.message.citations, ["refund-policy.md"]);

    const missing = await fetch(`${server.url}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "Hi" }] }),
    });
    assert.equal(missing.status, 400);

    const notFound = await fetch(`${server.url}/missing`);
    assert.equal(notFound.status, 404);

    const health = await fetch(`http://${new URL(server.url).host}/health`);
    assert.equal(health.status, 200);
  } finally {
    await server.close();
  }
});

test("findCase matches the trimmed question", async () => {
  const set = await loadQuestionSet(sampleCasesPath);
  assert.equal(findCase(set.cases, "  Who is the CEO of Acme? ")?.id, "q2");
  assert.equal(findCase(set.cases, "unknown"), undefined);
});

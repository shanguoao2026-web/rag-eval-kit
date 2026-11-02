import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { loadDocs, loadQuestionSet, parseQuestionSet } from "../src/load.js";
import { sampleCasesPath, sampleDocsDir } from "./helpers.js";

test("loads the sample question set", async () => {
  const set = await loadQuestionSet(sampleCasesPath);
  assert.equal(set.version, 1);
  assert.equal(set.cases.length, 7);
  const refund = set.cases[0];
  const ceo = set.cases[1];
  assert.ok(refund);
  assert.ok(ceo);
  assert.equal(refund.id, "q1");
  assert.equal(refund.question, "What is the refund window?");
  assert.deepEqual(refund.expect.contains_any, ["30 days", "thirty days"]);
  assert.deepEqual(refund.expect.citations_any, ["refund-policy.md"]);
  assert.equal(refund.expect.refuse, false);
  assert.equal(ceo.id, "q2");
  assert.equal(ceo.question, "Who is the CEO of Acme?");
  assert.equal(ceo.expect.refuse, true);
  assert.deepEqual(ceo.expect.refuse_markers_any, [
    "don't know",
    "not in",
    "insufficient",
    "cannot find",
    "no information",
  ]);
});

test("loads sample docs and skips nothing required", async () => {
  const docs = await loadDocs(sampleDocsDir);
  assert.deepEqual(
    docs.map((doc) => doc.id),
    ["faq.md", "privacy.md", "refund-policy.md", "shipping.md", "support-hours.md"],
  );
  const refund = docs.find((doc) => doc.id === "refund-policy.md");
  assert.ok(refund?.text.includes("30 days"));
});

test("loads nested markdown and ignores other extensions and symlinks", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rag-docs-"));
  const outsideRoot = await mkdtemp(path.join(tmpdir(), "rag-outside-"));
  await mkdir(path.join(root, "guides"));
  await writeFile(path.join(root, "guides", "policy.md"), "# Policy\n\nHello there.\n");
  await writeFile(path.join(root, "notes.TXT"), "Plain text notes.\n");
  await writeFile(path.join(root, "picture.png"), "not a doc");
  const outside = path.join(outsideRoot, "secret.md");
  await writeFile(outside, "hidden");
  await symlink(outside, path.join(root, "linked.md"));

  const docs = await loadDocs(root);
  assert.deepEqual(
    docs.map((doc) => doc.id),
    ["guides/policy.md", "notes.TXT"],
  );
});

test("rejects an empty docs directory", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rag-empty-"));
  await assert.rejects(() => loadDocs(root), /No markdown or text documents/);
});

test("rejects duplicate ids, duplicate questions, and a bad version", () => {
  assert.throws(
    () =>
      parseQuestionSet(`
version: 1
cases:
  - id: a
    question: Same?
    expect: { refuse: false }
  - id: a
    question: Other?
    expect: { refuse: false }
`),
    /duplicate case id/,
  );
  assert.throws(
    () =>
      parseQuestionSet(`
version: 1
cases:
  - id: a
    question: Same?
    expect: { refuse: true }
  - id: b
    question: Same?
    expect: { refuse: true }
`),
    /duplicate question/,
  );
  assert.throws(() => parseQuestionSet("version: 2\ncases:\n  - id: a\n    question: Q?\n    expect: { refuse: true }\n"), /unsupported version/);
});

test("rejects unknown expect keys and invalid fields", () => {
  assert.throws(
    () =>
      parseQuestionSet(`
version: 1
cases:
  - id: a
    question: Q?
    expect:
      citation_any: ["a.md"]
      refuse: false
`),
    /unknown key "citation_any"/,
  );
  assert.throws(
    () =>
      parseQuestionSet(`
version: 1
cases:
  - id: a
    question: Q?
    expect:
      overlap_min: 0.4
      refuse: false
`),
    /overlap_min requires expected_answer/,
  );
  assert.throws(
    () =>
      parseQuestionSet(`
version: 1
cases:
  - id: a
    question: Q?
    expect:
      expected_answer: "an answer"
      overlap_min: 2
      refuse: false
`),
    /overlap_min must be a number from 0 to 1/,
  );
  assert.throws(
    () =>
      parseQuestionSet(`
version: 1
cases:
  - id: a
    question: Q?
    expect:
      refuse: "yes"
`),
    /refuse must be a boolean/,
  );
  assert.throws(() => parseQuestionSet("version: 1\ncases: []\n"), /non-empty list/);
  assert.throws(() => parseQuestionSet("[\n]\n"), /must be a mapping/);
  assert.throws(() => parseQuestionSet("version: [\n"), /could not parse YAML/);
});

test("missing question set file has a readable error", async () => {
  await assert.rejects(() => loadQuestionSet("/tmp/does-not-exist-rag-eval-cases.yaml"), /Could not read question set/);
});

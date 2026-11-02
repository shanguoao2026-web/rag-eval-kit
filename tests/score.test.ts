import assert from "node:assert/strict";
import test from "node:test";

import { scoreCase, summarize } from "../src/score.js";
import type { Case, ModelResponse } from "../src/types.js";

function testCase(partial: Partial<Case> & Pick<Case, "expect">): Case {
  return {
    id: partial.id ?? "case",
    question: partial.question ?? "What is the refund window?",
    expect: partial.expect,
  };
}

function answer(content: string, citations: string[] = []): ModelResponse {
  return { content, citations };
}

test("contains_any passes when one phrase is present", () => {
  const result = scoreCase(
    testCase({ expect: { contains_any: ["30 days", "thirty days"], refuse: false } }),
    answer("The refund window is 30 days from delivery."),
  );
  assert.equal(result.answer_pass, true);
  assert.equal(result.answer_applicable, true);
  assert.equal(result.score, 1);
});

test("contains_any fails when none of the phrases are present", () => {
  const result = scoreCase(
    testCase({ expect: { contains_any: ["30 days", "thirty days"], refuse: false } }),
    answer("Returns are handled by the store manager."),
  );
  assert.equal(result.answer_pass, false);
  assert.ok(result.failed_checks.includes("answer"));
});

test("contains_any ignores case and collapsed whitespace", () => {
  const result = scoreCase(
    testCase({ expect: { contains_any: ["30 days"], refuse: false } }),
    answer("THE REFUND WINDOW IS 30\n\ndays FROM DELIVERY."),
  );
  assert.equal(result.answer_pass, true);
});

test("contains_all passes only when every phrase is present", () => {
  const expectation = { contains_all: ["personal data", "do not sell"], refuse: false };
  const pass = scoreCase(testCase({ expect: expectation }), answer("We do not sell personal data."));
  const fail = scoreCase(testCase({ expect: expectation }), answer("We do not sell gift cards."));
  assert.equal(pass.answer_pass, true);
  assert.equal(fail.answer_pass, false);
  assert.match(fail.reasons.answer, /personal data/);
});

test("expected_answer overlap passes at the minimum and fails under it", () => {
  const pass = scoreCase(
    testCase({
      expect: {
        expected_answer: "Standard shipping takes 3-5 business days.",
        overlap_min: 0.5,
        refuse: false,
      },
    }),
    answer("Standard shipping takes 3-5 business days."),
  );
  const fail = scoreCase(
    testCase({
      expect: {
        expected_answer: "purple elephant warranty coverage",
        overlap_min: 0.5,
        refuse: false,
      },
    }),
    answer("Standard shipping takes 3-5 business days."),
  );
  assert.equal(pass.answer_pass, true);
  assert.match(pass.reasons.answer, /token overlap 1\.00/);
  assert.equal(fail.answer_pass, false);
});

test("answer_pass is vacuously true when no answer criteria are set", () => {
  const result = scoreCase(
    testCase({ id: "q2", question: "Who is the CEO?", expect: { refuse: true, refuse_markers_any: ["don't know"] } }),
    answer("I don't know."),
  );
  assert.equal(result.answer_applicable, false);
  assert.equal(result.answer_pass, true);
  assert.equal(result.citation_pass, null);
  assert.equal(result.refuse_pass, true);
  assert.equal(result.score, 1);
});

test("citations_any matches basename, directory, and case", () => {
  const result = scoreCase(
    testCase({ expect: { citations_any: ["refund-policy.md"], refuse: false } }),
    answer("30 days.", ["Knowledge/Refund-Policy.MD"]),
  );
  assert.equal(result.citation_pass, true);
});

test("citations_any fails when a different file is cited", () => {
  const result = scoreCase(
    testCase({ expect: { citations_any: ["refund-policy.md"], refuse: false } }),
    answer("30 days.", ["faq.md"]),
  );
  assert.equal(result.citation_pass, false);
  assert.match(result.reasons.citation, /faq\.md/);
});

test("citations_all fails when one expected file is missing", () => {
  const result = scoreCase(
    testCase({
      expect: { citations_all: ["shipping.md", "privacy.md"], refuse: false },
    }),
    answer("See the docs.", ["docs/shipping.md"]),
  );
  assert.equal(result.citation_pass, false);
  assert.match(result.reasons.citation, /privacy\.md/);
});

test("citation_pass is null when no citations are expected", () => {
  const result = scoreCase(
    testCase({ expect: { refuse: false } }),
    answer("A normal answer with no refusal language."),
  );
  assert.equal(result.citation_pass, null);
  assert.equal(result.reasons.citation, "no citation expectation");
});

test("both citation lists must pass when any and all are set", () => {
  const result = scoreCase(
    testCase({
      expect: {
        citations_any: ["shipping.md", "faq.md"],
        citations_all: ["shipping.md", "privacy.md"],
        refuse: false,
      },
    }),
    answer("Orders ship soon.", ["shipping.md"]),
  );
  assert.equal(result.citation_pass, false);
});

test("refuse true passes when a configured marker is present", () => {
  const result = scoreCase(
    testCase({ expect: { refuse: true, refuse_markers_any: ["insufficient", "don't know"] } }),
    answer("There is insufficient information to answer."),
  );
  assert.equal(result.refuse_pass, true);
  assert.equal(result.refused, true);
});

test("refuse true fails when the model answers factually", () => {
  const result = scoreCase(
    testCase({ expect: { refuse: true, refuse_markers_any: ["don't know"] } }),
    answer("The CEO is Ada Lovelace."),
  );
  assert.equal(result.refuse_pass, false);
  assert.equal(result.refused, false);
});

test("refuse false fails when default refusal language is present", () => {
  const result = scoreCase(
    testCase({ expect: { contains_any: ["30 days"], refuse: false } }),
    answer("I don't know the refund window, but it might be 30 days."),
  );
  assert.equal(result.answer_pass, true);
  assert.equal(result.refuse_pass, false);
  assert.equal(result.score, 0.5);
  assert.match(result.reasons.refuse, /don't know/);
});

test("refuse false passes on a normal answer", () => {
  const result = scoreCase(
    testCase({ expect: { contains_any: ["30 days"], refuse: false } }),
    answer("The refund window is 30 days."),
  );
  assert.equal(result.refuse_pass, true);
  assert.equal(result.refused, false);
});

test("custom refuse markers replace the defaults", () => {
  const missed = scoreCase(
    testCase({ expect: { refuse: true, refuse_markers_any: ["haven't a clue"] } }),
    answer("I don't know."),
  );
  const hit = scoreCase(
    testCase({ expect: { refuse: true, refuse_markers_any: ["haven't a clue"] } }),
    answer("I haven't a clue about that."),
  );
  assert.equal(missed.refuse_pass, false);
  assert.equal(hit.refuse_pass, true);
});

test("score averages only the applicable checks", () => {
  const result = scoreCase(
    testCase({
      expect: {
        contains_any: ["30 days"],
        citations_any: ["refund-policy.md"],
        refuse: false,
      },
    }),
    answer("The refund window is 30 days.", ["other.md"]),
  );
  assert.equal(result.answer_pass, true);
  assert.equal(result.citation_pass, false);
  assert.equal(result.refuse_pass, true);
  assert.equal(result.score, 2 / 3);
  assert.deepEqual(result.failed_checks, ["citation"]);
});

test("summarize computes mean and pass rates", () => {
  const passed = scoreCase(
    testCase({ id: "ok", expect: { refuse: true, refuse_markers_any: ["don't know"] } }),
    answer("I don't know."),
  );
  const failed = scoreCase(
    testCase({ id: "bad", expect: { contains_any: ["30 days"], citations_any: ["refund-policy.md"], refuse: false } }),
    answer("I don't know.", []),
  );
  const summary = summarize([passed, failed]);
  assert.equal(summary.total, 2);
  assert.equal(summary.failures, 1);
  assert.equal(summary.full_passes, 1);
  assert.equal(summary.full_pass_rate, 0.5);
  assert.equal(summary.answer_applicable, 1);
  assert.equal(summary.answer_passes, 0);
  assert.equal(summary.answer_pass_rate, 0);
  assert.equal(summary.citation_applicable, 1);
  assert.equal(summary.citation_passes, 0);
  assert.equal(summary.refuse_passes, 1);
  assert.equal(summary.refuse_pass_rate, 0.5);
  assert.equal(summary.mean_score, (1 + failed.score) / 2);
});

test("summarize rejects an empty result list", () => {
  assert.throws(() => summarize([]), /No case results/);
});

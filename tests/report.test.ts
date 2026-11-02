import assert from "node:assert/strict";
import test from "node:test";

import { renderHtml, renderTerminal } from "../src/report.js";
import { scoreCase, summarize } from "../src/score.js";
import type { CaseResult, EvalReport } from "../src/types.js";

function reportFrom(results: CaseResult[]): EvalReport {
  return {
    version: "0.1.0",
    mode: "mock",
    model: "rag-eval-mock",
    docs_path: "docs",
    cases_path: "cases.yaml",
    doc_count: 1,
    doc_ids: ["refund-policy.md"],
    generated_at: "2026-11-02T00:00:00.000Z",
    elapsed_ms: 12,
    summary: summarize(results),
  };
}

test("terminal summary lists the mean score and failure ids", () => {
  const good = scoreCase(
    {
      id: "q1",
      question: "What is the refund window?",
      expect: { contains_any: ["30 days"], citations_any: ["refund-policy.md"], refuse: false },
    },
    { content: "The refund window is 30 days.", citations: ["refund-policy.md"] },
  );
  const bad = scoreCase(
    {
      id: "q2",
      question: "Who is the CEO of Acme?",
      expect: { refuse: true, refuse_markers_any: ["don't know"] },
    },
    { content: "Ada Lovelace.", citations: [] },
  );
  const text = renderTerminal(reportFrom([good, bad]));
  assert.match(text, /mean score\s+0\.500/);
  assert.match(text, /FAILURES \(1\)/);
  assert.match(text, /q2/);
  assert.match(text, /q1\s+1\.000\s+pass/);
  assert.match(text, /refuse pass rate\s+1\/2/);
});

test("html report escapes markup and highlights failures", () => {
  const bad = scoreCase(
    {
      id: "xss",
      question: `Who is <b>Acme</b> & friends?`,
      expect: { refuse: true, refuse_markers_any: ["don't know"] },
    },
    { content: `<script>alert("xss")</script>`, citations: [] },
  );
  const html = renderHtml(reportFrom([bad]));
  assert.match(html, /id="failures"/);
  assert.match(html, /1 of 1 cases failed/);
  assert.match(html, /&lt;script&gt;alert\(&quot;xss&quot;\)&lt;\/script&gt;/);
  assert.match(html, /Who is &lt;b&gt;Acme&lt;\/b&gt; &amp; friends\?/);
  assert.equal((html.match(/<script/gi) ?? []).length, 1);
  assert.equal(html.includes("<script>alert"), false);
  const data = html.match(/<script type="application\/json" id="rag-eval-data">([\s\S]*)<\/script>/);
  assert.ok(data?.[1]);
  const parsed = JSON.parse(data[1]) as EvalReport;
  assert.equal(parsed.summary.results[0]?.answer, `<script>alert("xss")</script>`);
  assert.match(html, /<style>/);
  assert.equal(html.includes("http://"), false);
});

test("html report announces a clean run", () => {
  const good = scoreCase(
    { id: "q1", question: "What is the refund window?", expect: { refuse: false } },
    { content: "The refund window is 30 days.", citations: [] },
  );
  const html = renderHtml(reportFrom([good]));
  assert.match(html, /All 1 cases passed/);
  assert.equal(html.includes('id="failures"'), false);
  assert.match(html, /citation n\/a/);
});

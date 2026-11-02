import type { CaseResult, EvalReport, Summary } from "./types.js";
import { truncate } from "./text.js";

export function formatScore(score: number): string {
  return score.toFixed(3);
}

export function formatPercent(score: number): string {
  return `${(score * 100).toFixed(1)}%`;
}

export function formatRate(rate: number | null, passed: number, total: number): string {
  if (rate === null || total === 0) return "n/a";
  return `${passed}/${total} (${Math.round(rate * 100)}%)`;
}

function statusWord(result: CaseResult): string {
  return result.score === 1 ? "pass" : "FAIL";
}

function oneLine(value: string, max = 220): string {
  return truncate(value, max);
}

export function renderTerminal(report: EvalReport): string {
  const summary = report.summary;
  const lines: string[] = [];
  lines.push(`rag-eval-kit ${report.version}`);
  lines.push(
    `mode: ${report.mode}    model: ${report.model}    docs: ${report.doc_count}    cases: ${summary.total}`,
  );
  lines.push(`docs path: ${report.docs_path}`);
  lines.push(`cases path: ${report.cases_path}`);
  if (report.base_url) lines.push(`base url: ${report.base_url}`);
  lines.push(`elapsed: ${report.elapsed_ms}ms`);
  lines.push("");
  lines.push(`mean score          ${formatScore(summary.mean_score)} (${formatPercent(summary.mean_score)})`);
  lines.push(
    `answer pass rate    ${formatRate(summary.answer_pass_rate, summary.answer_passes, summary.answer_applicable)}`,
  );
  lines.push(
    `citation pass rate  ${formatRate(summary.citation_pass_rate, summary.citation_passes, summary.citation_applicable)}`,
  );
  lines.push(
    `refuse pass rate    ${formatRate(summary.refuse_pass_rate, summary.refuse_passes, summary.total)}`,
  );
  lines.push(
    `full pass           ${formatRate(summary.full_pass_rate, summary.full_passes, summary.total)}`,
  );
  lines.push("");
  lines.push("CASES");
  for (const result of summary.results) {
    const id = result.id.padEnd(18, " ");
    const checks = result.failed_checks.length > 0 ? `  ${result.failed_checks.join(", ")}` : "";
    lines.push(`  ${id}${formatScore(result.score)}  ${statusWord(result)}${checks}`);
  }
  lines.push("");
  if (summary.failures === 0) {
    lines.push("All cases passed.");
  } else {
    const details = summary.results.filter((result) => result.score < 1);
    const shown = details.slice(0, 50);
    lines.push(`FAILURES (${summary.failures})`);
    for (const result of shown) {
      lines.push(`  ${result.id}  score ${formatScore(result.score)}  ${result.failed_checks.join(", ")}`);
      lines.push(`    Q: ${oneLine(result.question)}`);
      lines.push(`    A: ${oneLine(result.answer, 280)}`);
      lines.push(`    answer: ${result.reasons.answer}`);
      lines.push(`    citation: ${result.reasons.citation}`);
      lines.push(`    refuse: ${result.reasons.refuse}`);
      if (result.citation_pass === false) {
        lines.push(`    citations: ${result.citations.join(", ") || "(none)"}`);
      }
    }
    if (details.length > shown.length) {
      lines.push(`  … and ${details.length - shown.length} more in the HTML report`);
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

function badge(label: string, state: "pass" | "fail" | "na"): string {
  return `<span class="badge ${state}">${escapeHtml(label)}</span>`;
}

function answerBadge(result: CaseResult): string {
  if (!result.answer_applicable) return badge("answer n/a", "na");
  return badge(result.answer_pass ? "answer pass" : "answer fail", result.answer_pass ? "pass" : "fail");
}

function citationBadge(result: CaseResult): string {
  if (result.citation_pass === null) return badge("citation n/a", "na");
  return badge(
    result.citation_pass ? "citation pass" : "citation fail",
    result.citation_pass ? "pass" : "fail",
  );
}

function refuseBadge(result: CaseResult): string {
  return badge(result.refuse_pass ? "refuse pass" : "refuse fail", result.refuse_pass ? "pass" : "fail");
}

function stat(label: string, value: string): string {
  return `<div class="stat"><div class="stat-label">${escapeHtml(label)}</div><div class="stat-value">${escapeHtml(value)}</div></div>`;
}

function caseBlock(result: CaseResult, open: boolean): string {
  const openAttr = open ? " open" : "";
  const citations = result.citations.length > 0 ? result.citations.map((item) => escapeHtml(item)).join(", ") : "(none)";
  return `<details class="case${result.score === 1 ? "" : " case-fail"}"${openAttr}>
  <summary><span class="case-id">${escapeHtml(result.id)}</span><span class="case-score">${formatScore(result.score)}</span>${answerBadge(result)}${citationBadge(result)}${refuseBadge(result)}</summary>
  <div class="case-body">
    <p class="question">${escapeHtml(result.question)}</p>
    <h3>Answer</h3>
    <pre>${escapeHtml(result.answer)}</pre>
    <h3>Citations</h3>
    <p>${citations}</p>
    <ul class="reasons">
      <li>${escapeHtml(result.reasons.answer)}</li>
      <li>${escapeHtml(result.reasons.citation)}</li>
      <li>${escapeHtml(result.reasons.refuse)}</li>
    </ul>
  </div>
</details>`;
}

function rateLabel(summary: Summary, kind: "answer" | "citation" | "refuse" | "full"): string {
  if (kind === "answer") return formatRate(summary.answer_pass_rate, summary.answer_passes, summary.answer_applicable);
  if (kind === "citation") {
    return formatRate(summary.citation_pass_rate, summary.citation_passes, summary.citation_applicable);
  }
  if (kind === "refuse") return formatRate(summary.refuse_pass_rate, summary.refuse_passes, summary.total);
  return formatRate(summary.full_pass_rate, summary.full_passes, summary.total);
}

const CSS = `
:root {
  --ink: #1b2430;
  --muted: #5e6a78;
  --line: #e3e7ee;
  --paper: #f3f5f8;
  --card: #ffffff;
  --pass: #0c7a43;
  --pass-bg: #e8f6ee;
  --fail: #a61b16;
  --fail-bg: #fdeceb;
  --na: #667085;
  --na-bg: #eef1f4;
  --accent: #1e3a5f;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font: 15px/1.5 "Segoe UI", system-ui, sans-serif;
}
header, main { max-width: 980px; margin: 0 auto; padding: 24px 20px; }
header { padding-bottom: 0; }
h1 { font-size: 28px; line-height: 1.2; margin: 0 0 8px; letter-spacing: -0.02em; }
h2 { font-size: 18px; margin: 28px 0 12px; }
h3 { font-size: 13px; margin: 14px 0 6px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
.meta { color: var(--muted); margin: 0; }
.banner {
  margin-top: 18px;
  padding: 12px 14px;
  border-radius: 8px;
  background: var(--pass-bg);
  color: var(--pass);
  font-weight: 650;
}
.banner.bad { background: var(--fail-bg); color: var(--fail); }
.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;
  margin-top: 16px;
}
.stat {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 12px;
}
.stat-label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
.stat-value { font-size: 20px; font-weight: 650; margin-top: 4px; }
.fail-wrap {
  border-left: 4px solid var(--fail);
  background: var(--card);
  border-radius: 8px;
  padding: 4px 14px 12px;
}
.legend { color: var(--muted); font-size: 13px; }
.badge {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 650;
  vertical-align: 1px;
}
.badge.pass { background: var(--pass-bg); color: var(--pass); }
.badge.fail { background: var(--fail-bg); color: var(--fail); }
.badge.na { background: var(--na-bg); color: var(--na); }
details.case {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 8px;
  margin: 8px 0;
  padding: 8px 12px;
}
details.case-fail { background: var(--fail-bg); border-color: #f3c7c3; }
summary { cursor: pointer; }
.case-id { font-weight: 700; margin-right: 8px; }
.case-score { font-variant-numeric: tabular-nums; color: var(--accent); margin-right: 4px; }
.question { font-size: 16px; margin: 8px 0; }
pre {
  white-space: pre-wrap;
  word-break: break-word;
  background: #f8fafc;
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 10px;
  margin: 0;
  font: 13px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
table { width: 100%; border-collapse: collapse; background: var(--card); border-radius: 8px; overflow: hidden; }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
tr.row-fail { background: var(--fail-bg); }
.table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 8px; }
ul.reasons { margin: 8px 0 0; padding-left: 18px; }
.doc-list { color: var(--muted); font-size: 13px; }
@media print {
  body { background: white; }
  header, main { max-width: none; }
  details.case { break-inside: avoid; }
}
`;

/** Self-contained HTML report. Failures are expanded and listed before the full table. */
export function renderHtml(report: EvalReport): string {
  const summary = report.summary;
  const failures = summary.results.filter((result) => result.score < 1);
  const banner =
    failures.length === 0
      ? `<p class="banner">All ${summary.total} cases passed.</p>`
      : `<p class="banner bad">${failures.length} of ${summary.total} cases failed. Mean score ${formatScore(summary.mean_score)}.</p>`;

  const failureSection =
    failures.length === 0
      ? ""
      : `<section id="failures"><h2>Failures</h2><div class="fail-wrap">${failures
          .map((result) => caseBlock(result, true))
          .join("\n")}</div></section>`;

  const rows = summary.results
    .map((result) => {
      const klass = result.score === 1 ? "" : ` class="row-fail"`;
      return `<tr${klass}><td>${escapeHtml(result.id)}</td><td>${formatScore(result.score)}</td><td>${escapeHtml(result.question)}</td><td>${answerBadge(result)} ${citationBadge(result)} ${refuseBadge(result)}</td></tr>`;
    })
    .join("\n");

  const docs = report.doc_ids.map((id) => escapeHtml(id)).join(", ");
  const base = report.base_url ? `<p class="meta">Endpoint ${escapeHtml(report.base_url)}</p>` : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>RAG eval report${failures.length > 0 ? ` — ${failures.length} failed` : ""}</title>
<style>${CSS}</style>
</head>
<body>
<header>
  <h1>RAG eval report</h1>
  <p class="meta">rag-eval-kit ${escapeHtml(report.version)} · ${escapeHtml(report.mode)} · model ${escapeHtml(report.model)} · ${escapeHtml(report.generated_at)}</p>
  <p class="meta">Docs ${escapeHtml(report.docs_path)} (${report.doc_count}) · cases ${escapeHtml(report.cases_path)} · ${report.elapsed_ms}ms</p>
  ${base}
  ${banner}
  <div class="stats">
    ${stat("Mean score", `${formatScore(summary.mean_score)} (${formatPercent(summary.mean_score)})`)}
    ${stat("Answer", rateLabel(summary, "answer"))}
    ${stat("Citation", rateLabel(summary, "citation"))}
    ${stat("Refusal", rateLabel(summary, "refuse"))}
    ${stat("Full pass", rateLabel(summary, "full"))}
  </div>
</header>
<main>
  <p class="legend">Score is the mean of the checks that apply to a case. Answer and citation checks are skipped when the case does not set them. Refusal is always checked. Citation n/a means the case did not expect a citation.</p>
  <p class="doc-list">Corpus: ${docs}</p>
  ${failureSection}
  <section id="all-cases">
    <h2>All cases</h2>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Id</th><th>Score</th><th>Question</th><th>Checks</th></tr></thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
    ${summary.results.map((result) => caseBlock(result, result.score < 1)).join("\n")}
  </section>
</main>
<script type="application/json" id="rag-eval-data">${safeJson(report)}</script>
</body>
</html>
`;
}

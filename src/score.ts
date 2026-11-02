import { citationsMatch } from "./citations.js";
import { EvalError } from "./errors.js";
import type { Case, CaseResult, Expectation, ModelResponse, Summary } from "./types.js";
import { containsPhrase, DEFAULT_OVERLAP_MIN, tokenize, tokenOverlap, unique } from "./text.js";

/**
 * Phrases that count as a refusal when a case does not supply `refuse_markers_any`.
 * They are full phrases on purpose. Short fragments such as "not in" are too easy to
 * hit inside a normal answer, so they are used only when a case lists them.
 */
export const DEFAULT_REFUSE_MARKERS: readonly string[] = [
  "don't know",
  "do not know",
  "insufficient information",
  "not enough information",
  "no information",
  "cannot find",
  "can't find",
  "unable to answer",
  "cannot answer",
  "not in the provided",
  "no relevant information",
];

function quoteList(items: readonly string[]): string {
  if (items.length === 0) return "(none)";
  return items.map((item) => `"${item}"`).join(", ");
}

function markersFor(expectation: Expectation): string[] {
  if (expectation.refuse_markers_any && expectation.refuse_markers_any.length > 0) {
    return expectation.refuse_markers_any;
  }
  return [...DEFAULT_REFUSE_MARKERS];
}

function scoreAnswer(answer: string, expectation: Expectation): {
  applicable: boolean;
  pass: boolean;
  reason: string;
} {
  const checks: boolean[] = [];
  const reasons: string[] = [];

  if (expectation.contains_any && expectation.contains_any.length > 0) {
    const matched = expectation.contains_any.filter((phrase) => containsPhrase(answer, phrase));
    const ok = matched.length > 0;
    checks.push(ok);
    reasons.push(
      ok
        ? `matched phrase ${quoteList(matched.slice(0, 1))}`
        : `answer did not contain any of: ${quoteList(expectation.contains_any)}`,
    );
  }

  if (expectation.contains_all && expectation.contains_all.length > 0) {
    const missing = expectation.contains_all.filter((phrase) => !containsPhrase(answer, phrase));
    const ok = missing.length === 0;
    checks.push(ok);
    reasons.push(
      ok
        ? "answer contained every required phrase"
        : `answer was missing: ${quoteList(missing)}`,
    );
  }

  if (expectation.expected_answer && expectation.expected_answer.trim()) {
    const expectedTokens = unique(tokenize(expectation.expected_answer));
    const minimum = expectation.overlap_min ?? DEFAULT_OVERLAP_MIN;
    if (expectedTokens.length === 0) {
      checks.push(false);
      reasons.push("expected answer has no scorable tokens");
    } else {
      const ratio = tokenOverlap(expectation.expected_answer, answer);
      const ok = ratio + 1e-12 >= minimum;
      checks.push(ok);
      reasons.push(`token overlap ${ratio.toFixed(2)} (minimum ${minimum.toFixed(2)})`);
    }
  }

  if (checks.length === 0) {
    return { applicable: false, pass: true, reason: "no answer expectation" };
  }
  return {
    applicable: true,
    pass: checks.every(Boolean),
    reason: reasons.join("; "),
  };
}

function scoreCitations(citations: readonly string[], expectation: Expectation): {
  pass: boolean | null;
  reason: string;
} {
  const any = expectation.citations_any ?? [];
  const all = expectation.citations_all ?? [];
  if (any.length === 0 && all.length === 0) {
    return { pass: null, reason: "no citation expectation" };
  }

  const got = citations.length > 0 ? citations.join(", ") : "(none)";
  const reasons: string[] = [];
  const checks: boolean[] = [];

  if (any.length > 0) {
    const ok = any.some((expected) => citations.some((actual) => citationsMatch(expected, actual)));
    checks.push(ok);
    reasons.push(
      ok
        ? `matched one of ${quoteList(any)}`
        : `expected one of: ${any.join(", ")}; got: ${got}`,
    );
  }

  if (all.length > 0) {
    const missing = all.filter(
      (expected) => !citations.some((actual) => citationsMatch(expected, actual)),
    );
    const ok = missing.length === 0;
    checks.push(ok);
    reasons.push(
      ok
        ? `matched all of ${quoteList(all)}`
        : `missing: ${missing.join(", ")}; got: ${got}`,
    );
  }

  return { pass: checks.every(Boolean), reason: reasons.join("; ") };
}

/**
 * Score one model answer.
 *
 * Applicable checks are the answer check (only when phrase or overlap expectations
 * are set), the citation check (only when citations are expected), and the refusal
 * check (always). The case score is the mean of those checks. A missing citation
 * expectation is `citation_pass: null` and is left out of the mean.
 */
export function scoreCase(testCase: Case, response: ModelResponse): CaseResult {
  const answer = response.content ?? "";
  const citations = unique(response.citations.map((item) => item.trim()).filter(Boolean));
  const expectation = testCase.expect;
  const expectRefuse = expectation.refuse === true;

  const answerResult = scoreAnswer(answer, expectation);
  const citationResult = scoreCitations(citations, expectation);
  const markers = markersFor(expectation);
  const matched = markers.filter((marker) => containsPhrase(answer, marker));
  const refused = matched.length > 0;
  const refusePass = refused === expectRefuse;

  let refuseReason: string;
  if (expectRefuse && refused) {
    refuseReason = `expected a refusal and found one (matched ${quoteList(matched.slice(0, 3))})`;
  } else if (expectRefuse && !refused) {
    refuseReason = "expected a refusal but no marker matched";
  } else if (!expectRefuse && refused) {
    refuseReason = `expected an answer but found refusal language (matched ${quoteList(matched.slice(0, 3))})`;
  } else {
    refuseReason = "expected an answer and did not find refusal language";
  }

  const parts: number[] = [];
  if (answerResult.applicable) parts.push(answerResult.pass ? 1 : 0);
  if (citationResult.pass !== null) parts.push(citationResult.pass ? 1 : 0);
  parts.push(refusePass ? 1 : 0);
  const score = parts.reduce((sum, part) => sum + part, 0) / parts.length;

  const failed: CaseResult["failed_checks"] = [];
  if (answerResult.applicable && !answerResult.pass) failed.push("answer");
  if (citationResult.pass === false) failed.push("citation");
  if (!refusePass) failed.push("refuse");

  return {
    id: testCase.id,
    question: testCase.question,
    answer,
    citations,
    answer_pass: answerResult.pass,
    answer_applicable: answerResult.applicable,
    citation_pass: citationResult.pass,
    refuse_pass: refusePass,
    refused,
    score,
    failed_checks: failed,
    expectation: {
      ...expectation,
      refuse: expectRefuse,
    },
    reasons: {
      answer: answerResult.reason,
      citation: citationResult.reason,
      refuse: refuseReason,
    },
  };
}

export function summarize(results: readonly CaseResult[]): Summary {
  if (results.length === 0) {
    throw new EvalError("No case results to summarize");
  }
  const total = results.length;
  const mean = results.reduce((sum, result) => sum + result.score, 0) / total;
  const fullPasses = results.filter((result) => result.score === 1).length;

  const answerCases = results.filter((result) => result.answer_applicable);
  const answerPasses = answerCases.filter((result) => result.answer_pass).length;
  const citationCases = results.filter((result) => result.citation_pass !== null);
  const citationPasses = citationCases.filter((result) => result.citation_pass === true).length;
  const refusePasses = results.filter((result) => result.refuse_pass).length;

  return {
    total,
    mean_score: mean,
    failures: total - fullPasses,
    full_passes: fullPasses,
    full_pass_rate: fullPasses / total,
    answer_passes: answerPasses,
    answer_applicable: answerCases.length,
    answer_pass_rate: answerCases.length === 0 ? null : answerPasses / answerCases.length,
    citation_passes: citationPasses,
    citation_applicable: citationCases.length,
    citation_pass_rate: citationCases.length === 0 ? null : citationPasses / citationCases.length,
    refuse_passes: refusePasses,
    refuse_pass_rate: refusePasses / total,
    results: [...results],
  };
}

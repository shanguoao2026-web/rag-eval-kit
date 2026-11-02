import { completeChat, stripUrlCredentials } from "./client.js";
import { loadDocs, loadQuestionSet } from "./load.js";
import { mockAnswer } from "./mock.js";
import { readPackageVersion } from "./paths.js";
import { scoreCase, summarize } from "./score.js";
import type { EvalReport, RunOptions } from "./types.js";
import { EvalError } from "./errors.js";

/** Load the corpus and question set, call the endpoint or the in-process mock, and score every case. */
export async function runEval(options: RunOptions): Promise<EvalReport> {
  const started = Date.now();
  const questionSet = await loadQuestionSet(options.casesPath);
  const docs = await loadDocs(options.docsPath);
  const mode = options.mock ? "mock" : "live";
  const model = options.model ?? (options.mock ? "rag-eval-mock" : undefined);
  if (!options.mock && !options.baseUrl) {
    throw new EvalError(
      "A base URL is required unless --mock is set. Set --base-url or RAG_EVAL_BASE_URL.",
    );
  }
  if (!model) {
    throw new EvalError("A model is required for live runs. Set --model or RAG_EVAL_MODEL.");
  }

  const results = [];
  const total = questionSet.cases.length;
  for (let index = 0; index < total; index += 1) {
    const testCase = questionSet.cases[index];
    if (!testCase) continue;
    const response = options.mock
      ? mockAnswer(testCase.question, docs, {
          id: testCase.id,
          refuse: testCase.expect.refuse === true,
          refuseMarkers: testCase.expect.refuse_markers_any,
        })
      : await completeChat({
          baseUrl: options.baseUrl ?? "",
          apiKey: options.apiKey,
          model,
          question: testCase.question,
          timeoutMs: options.timeoutMs,
        });
    const result = scoreCase(testCase, response);
    results.push(result);
    options.onCase?.({ index, total, result });
  }

  const generated = options.now ?? new Date();
  return {
    version: readPackageVersion(),
    mode,
    model,
    ...(options.mock || !options.baseUrl ? {} : { base_url: stripUrlCredentials(options.baseUrl) }),
    docs_path: options.docsPath,
    cases_path: options.casesPath,
    doc_count: docs.length,
    doc_ids: docs.map((doc) => doc.id),
    generated_at: generated.toISOString(),
    elapsed_ms: Date.now() - started,
    summary: summarize(results),
  };
}

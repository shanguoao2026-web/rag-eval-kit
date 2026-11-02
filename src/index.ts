export { completeChat, DEFAULT_TIMEOUT_MS, joinCompletionsUrl, parseChatCompletion, SYSTEM_PROMPT } from "./client.js";
export { EvalError } from "./errors.js";
export { initSample } from "./init-sample.js";
export { loadDocs, loadQuestionSet, parseQuestionSet } from "./load.js";
export { mockAnswer, REFUSAL_TEXT, retrieve, startMockServer } from "./mock.js";
export { readPackageVersion } from "./paths.js";
export { renderHtml, renderTerminal } from "./report.js";
export { runEval } from "./run.js";
export { DEFAULT_REFUSE_MARKERS, scoreCase, summarize } from "./score.js";
export { DEFAULT_OVERLAP_MIN } from "./text.js";

export type {
  Case,
  CaseResult,
  CheckName,
  Doc,
  EvalReport,
  Expectation,
  ModelResponse,
  QuestionSet,
  RunOptions,
  Summary,
} from "./types.js";
export type { MockServer, RetrievalHit } from "./mock.js";

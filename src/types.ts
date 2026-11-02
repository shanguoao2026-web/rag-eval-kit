export interface Expectation {
  contains_any?: string[];
  contains_all?: string[];
  expected_answer?: string;
  overlap_min?: number;
  citations_any?: string[];
  citations_all?: string[];
  /** When omitted, the case must not refuse. */
  refuse?: boolean;
  refuse_markers_any?: string[];
}

export interface Case {
  id: string;
  question: string;
  expect: Expectation;
}

export interface QuestionSet {
  version: 1;
  cases: Case[];
}

export interface Doc {
  /** Path relative to the docs root, using forward slashes. */
  id: string;
  filename: string;
  path: string;
  text: string;
}

export interface ModelResponse {
  content: string;
  citations: string[];
}

export type CheckName = "answer" | "citation" | "refuse";

export interface CaseResult {
  id: string;
  question: string;
  answer: string;
  citations: string[];
  answer_pass: boolean;
  answer_applicable: boolean;
  citation_pass: boolean | null;
  refuse_pass: boolean;
  refused: boolean;
  score: number;
  failed_checks: CheckName[];
  expectation: Expectation;
  reasons: {
    answer: string;
    citation: string;
    refuse: string;
  };
}

export interface Summary {
  total: number;
  mean_score: number;
  failures: number;
  full_passes: number;
  full_pass_rate: number;
  answer_passes: number;
  answer_applicable: number;
  answer_pass_rate: number | null;
  citation_passes: number;
  citation_applicable: number;
  citation_pass_rate: number | null;
  refuse_passes: number;
  refuse_pass_rate: number;
  results: CaseResult[];
}

export interface EvalReport {
  version: string;
  mode: "mock" | "live";
  model: string;
  base_url?: string;
  docs_path: string;
  cases_path: string;
  doc_count: number;
  doc_ids: string[];
  generated_at: string;
  elapsed_ms: number;
  summary: Summary;
}

export interface RunOptions {
  docsPath: string;
  casesPath: string;
  mock: boolean;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  now?: Date;
  onCase?: (event: { index: number; total: number; result: CaseResult }) => void;
}

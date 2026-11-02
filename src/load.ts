import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";

import { EvalError } from "./errors.js";
import type { Case, Doc, Expectation, QuestionSet } from "./types.js";

const DOC_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".text"]);
const MAX_DOC_BYTES = 5_000_000;

const ROOT_KEYS = new Set(["version", "cases"]);
const CASE_KEYS = new Set(["id", "question", "expect"]);
const EXPECT_KEYS = new Set([
  "contains_any",
  "contains_all",
  "expected_answer",
  "overlap_min",
  "citations_any",
  "citations_all",
  "refuse",
  "refuse_markers_any",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(filename: string, message: string): never {
  throw new EvalError(`${filename}: ${message}`);
}

function unknownKeys(record: Record<string, unknown>, allowed: Set<string>): string[] {
  return Object.keys(record).filter((key) => !allowed.has(key));
}

function readStringArray(filename: string, value: unknown, label: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) {
    fail(filename, `${label} must be a non-empty list of strings`);
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.trim() === "") {
      fail(filename, `${label} must contain only non-empty strings`);
    }
    out.push(item);
  }
  return out;
}

function readExpectation(filename: string, value: unknown, where: string): Expectation {
  if (!isRecord(value)) fail(filename, `${where}.expect must be a mapping`);
  const extra = unknownKeys(value, EXPECT_KEYS);
  if (extra.length > 0) {
    fail(filename, `${where}.expect: unknown key ${extra.map((key) => `"${key}"`).join(", ")}`);
  }

  const expectation: Expectation = {};
  const containsAny = readStringArray(filename, value.contains_any, `${where}.expect.contains_any`);
  const containsAll = readStringArray(filename, value.contains_all, `${where}.expect.contains_all`);
  const citationsAny = readStringArray(filename, value.citations_any, `${where}.expect.citations_any`);
  const citationsAll = readStringArray(filename, value.citations_all, `${where}.expect.citations_all`);
  const markers = readStringArray(
    filename,
    value.refuse_markers_any,
    `${where}.expect.refuse_markers_any`,
  );

  if (containsAny) expectation.contains_any = containsAny;
  if (containsAll) expectation.contains_all = containsAll;
  if (citationsAny) expectation.citations_any = citationsAny;
  if (citationsAll) expectation.citations_all = citationsAll;
  if (markers) expectation.refuse_markers_any = markers;

  if (value.expected_answer !== undefined) {
    if (typeof value.expected_answer !== "string" || value.expected_answer.trim() === "") {
      fail(filename, `${where}.expect.expected_answer must be a non-empty string`);
    }
    expectation.expected_answer = value.expected_answer;
  }

  if (value.overlap_min !== undefined) {
    if (typeof value.overlap_min !== "number" || !Number.isFinite(value.overlap_min)) {
      fail(filename, `${where}.expect.overlap_min must be a number from 0 to 1`);
    }
    if (value.overlap_min < 0 || value.overlap_min > 1) {
      fail(filename, `${where}.expect.overlap_min must be a number from 0 to 1`);
    }
    if (!expectation.expected_answer) {
      fail(filename, `${where}.expect.overlap_min requires expected_answer`);
    }
    expectation.overlap_min = value.overlap_min;
  }

  if (value.refuse !== undefined) {
    if (typeof value.refuse !== "boolean") {
      fail(filename, `${where}.expect.refuse must be a boolean`);
    }
    expectation.refuse = value.refuse;
  }

  return expectation;
}

/** Parse and validate a question set. `filename` is only used in error messages. */
export function parseQuestionSet(text: string, filename = "cases.yaml"): QuestionSet {
  let value: unknown;
  try {
    value = parse(text, { maxAliasCount: 50, uniqueKeys: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(filename, `could not parse YAML: ${message}`);
  }

  if (!isRecord(value)) fail(filename, "question set must be a mapping");
  const extra = unknownKeys(value, ROOT_KEYS);
  if (extra.length > 0) {
    fail(filename, `unknown key ${extra.map((key) => `"${key}"`).join(", ")}`);
  }
  if (value.version !== 1 && value.version !== "1") {
    fail(filename, `unsupported version ${JSON.stringify(value.version)}. Expected 1`);
  }
  if (!Array.isArray(value.cases) || value.cases.length === 0) {
    fail(filename, "cases must be a non-empty list");
  }

  const ids = new Set<string>();
  const questions = new Set<string>();
  const cases: Case[] = [];

  for (let index = 0; index < value.cases.length; index += 1) {
    const raw = value.cases[index];
    const where = `cases[${index}]`;
    if (!isRecord(raw)) fail(filename, `${where} must be a mapping`);
    const caseExtra = unknownKeys(raw, CASE_KEYS);
    if (caseExtra.length > 0) {
      fail(filename, `${where}: unknown key ${caseExtra.map((key) => `"${key}"`).join(", ")}`);
    }
    if (typeof raw.id !== "string" || raw.id.trim() === "") {
      fail(filename, `${where}.id must be a non-empty string`);
    }
    if (typeof raw.question !== "string" || raw.question.trim() === "") {
      fail(filename, `${where}.question must be a non-empty string`);
    }
    const id = raw.id.trim();
    const question = raw.question.trim();
    if (ids.has(id)) fail(filename, `duplicate case id "${id}"`);
    if (questions.has(question)) fail(filename, `duplicate question "${question}"`);
    ids.add(id);
    questions.add(question);
    if (raw.expect === undefined) fail(filename, `${where}.expect is required`);
    cases.push({
      id,
      question,
      expect: readExpectation(filename, raw.expect, where),
    });
  }

  return { version: 1, cases };
}

export async function loadQuestionSet(file: string): Promise<QuestionSet> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new EvalError(`Could not read question set ${file}: ${message}`);
  }
  return parseQuestionSet(text, file);
}

async function walkDocs(root: string, current: string, docs: Doc[]): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true });
  const sorted = entries.slice().sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of sorted) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isSymbolicLink()) continue;
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) {
      await walkDocs(root, full, docs);
      continue;
    }
    if (!entry.isFile()) continue;
    const extension = path.extname(entry.name).toLowerCase();
    if (!DOC_EXTENSIONS.has(extension)) continue;
    const info = await stat(full);
    if (info.size > MAX_DOC_BYTES) {
      const rel = path.relative(root, full);
      throw new EvalError(`Document exceeds 5MB: ${rel}`);
    }
    let text = await readFile(full, "utf8");
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const rel = path.relative(root, full).split(path.sep).join("/");
    docs.push({
      id: rel,
      filename: entry.name,
      path: full,
      text,
    });
  }
}

/** Load `.md`, `.markdown`, `.txt`, and `.text` files. Symlinks are skipped. */
export async function loadDocs(dir: string): Promise<Doc[]> {
  let info;
  try {
    info = await stat(dir);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new EvalError(`Could not read docs directory ${dir}: ${message}`);
  }
  if (!info.isDirectory()) {
    throw new EvalError(`Docs path is not a directory: ${dir}`);
  }
  const docs: Doc[] = [];
  await walkDocs(dir, dir, docs);
  docs.sort((a, b) => a.id.localeCompare(b.id));
  if (docs.length === 0) {
    throw new EvalError(`No markdown or text documents found in ${dir}`);
  }
  return docs;
}

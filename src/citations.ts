import { unique } from "./text.js";

const FILENAME_RE = /\b[\w./-]+\.(?:md|markdown|txt|text)\b/gi;
const SOURCE_LINE_RE = /(?:^|\n)\s*(?:sources?|citations?|references?)\s*:\s*([^\n]+)/gi;

/** Normalize a doc id or filename for comparison. Does not require the file to exist. */
export function normalizeCitation(raw: string): string {
  let value = raw.trim();
  value = value.replace(/^["'`(<\[]+|["'`>)\]]+$/g, "");
  value = value.replace(/\\/g, "/");
  value = value.replace(/^\.\/+/, "");
  value = value.replace(/^\/+/, "");
  value = value.replace(/[),.;:]+$/g, "");
  return value.toLowerCase();
}

function baseName(value: string): string {
  const parts = value.split("/");
  return parts[parts.length - 1] ?? value;
}

export function citationsMatch(expected: string, actual: string): boolean {
  const left = normalizeCitation(expected);
  const right = normalizeCitation(actual);
  if (!left || !right) return false;
  if (left === right) return true;
  const leftBase = baseName(left);
  const rightBase = baseName(right);
  if (leftBase.length > 0 && leftBase === rightBase) return true;
  if (right.endsWith(`/${left}`) || left.endsWith(`/${right}`)) return true;
  return false;
}

function citationToString(item: unknown): string | null {
  if (typeof item === "string") return item;
  if (!item || typeof item !== "object") return null;
  const record = item as Record<string, unknown>;
  for (const key of ["doc_id", "docId", "filename", "file", "source", "path", "id"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  const metadata = record.metadata;
  if (metadata && typeof metadata === "object") {
    const meta = metadata as Record<string, unknown>;
    for (const key of ["doc_id", "docId", "filename", "file", "source", "path", "id"]) {
      const value = meta[key];
      if (typeof value === "string" && value.trim()) return value;
    }
  }
  return null;
}

function fromSourceLine(segment: string): string[] {
  return segment
    .split(/[,;]|\band\b/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .filter((part) => !/\s/.test(part) || /\.(?:md|markdown|txt|text)$/i.test(part));
}

/** Pull filenames out of an answer. Structured API fields are handled separately. */
export function extractCitationsFromText(content: string): string[] {
  const found: string[] = [];
  for (const match of content.matchAll(SOURCE_LINE_RE)) {
    const segment = match[1] ?? "";
    found.push(...fromSourceLine(segment));
  }
  for (const match of content.matchAll(FILENAME_RE)) {
    found.push(match[0]);
  }
  return found;
}

export function collectCitations(content: string, structured: readonly unknown[]): string[] {
  const raw: string[] = [];
  for (const item of structured) {
    const text = citationToString(item);
    if (text) raw.push(text);
  }
  raw.push(...extractCitationsFromText(content));
  const normalized = raw.map((item) => normalizeCitation(item)).filter((item) => item.length > 0);
  return unique(normalized);
}

/** Small English stopword list. Dropped from overlap and retrieval tokens, not from phrase checks. */
export const STOPWORDS: ReadonlySet<string> = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "what", "who", "whom", "when", "where", "why", "how", "which",
  "do", "does", "did", "doing",
  "of", "for", "to", "in", "on", "at", "by", "from", "with", "as", "into", "about",
  "and", "or", "but", "if", "then",
  "this", "that", "these", "those", "it", "its",
  "i", "we", "you", "your", "our", "they", "their",
  "not", "no", "yes",
  "can", "could", "should", "would", "may", "might",
  "have", "has", "had",
]);

export const DEFAULT_OVERLAP_MIN = 0.5;

export function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Case-insensitive substring check after whitespace is collapsed. */
export function containsPhrase(haystack: string, needle: string): boolean {
  const left = normalizeForMatch(haystack);
  const right = normalizeForMatch(needle);
  if (right.length === 0) return false;
  return left.includes(right);
}

export function unique(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

/**
 * Alphanumeric tokens used for overlap and retrieval.
 * Tokens of length 1 are kept only when they contain a digit, so "5" still counts.
 */
export function tokenize(text: string): string[] {
  const matches = normalizeForMatch(text).match(/[a-z0-9]+/g) ?? [];
  return matches.filter((token) => !STOPWORDS.has(token) && (token.length >= 2 || /\d/.test(token)));
}

/** Share of expected tokens that also appear in the answer. 0 when the expectation has no tokens. */
export function tokenOverlap(expected: string, actual: string): number {
  const expectedTokens = unique(tokenize(expected));
  if (expectedTokens.length === 0) return 0;
  const actualTokens = new Set(tokenize(actual));
  let hit = 0;
  for (const token of expectedTokens) {
    if (actualTokens.has(token)) hit += 1;
  }
  return hit / expectedTokens.length;
}

export function splitSentences(text: string): string[] {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const sentences: string[] = [];
  for (const line of normalized.split(/\n+/)) {
    const stripped = line.replace(/^#{1,6}\s+/, "").replace(/^[-*]\s+/, "").trim();
    if (!stripped || stripped === "---") continue;
    for (const part of stripped.split(/(?<=[.!?])\s+/)) {
      const sentence = part.trim();
      if (sentence) sentences.push(sentence);
    }
  }
  return sentences;
}

export function truncate(value: string, max: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, Math.max(0, max - 1))}…`;
}

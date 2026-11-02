import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { normalizeCitation } from "./citations.js";
import type { Case, Doc, ModelResponse } from "./types.js";
import { containsPhrase, splitSentences, tokenize, unique } from "./text.js";

/**
 * Fixed refusal used for `expect.refuse: true`.
 * It contains every default refusal marker, plus any case-specific marker that is missing,
 * so offline runs exercise the scorer instead of a live model.
 * Factual answers do not use this text and do not read `contains_*` expectations.
 */
export const REFUSAL_TEXT =
  "I don't know, and I do not know of a grounded answer. " +
  "There is insufficient information and not enough information to answer. " +
  "I cannot find a source, I can't find one, and I am unable to answer. " +
  "I cannot answer from the knowledge base. " +
  "The answer is not in the provided documents. " +
  "There is no relevant information here, and there is no information available.";

export interface RetrievalHit {
  docId: string;
  sentence: string;
  score: number;
}

export interface MockAnswerOptions {
  id?: string;
  refuse?: boolean;
  refuseMarkers?: string[];
}

function filenameTokens(docId: string): string[] {
  const base = docId.split("/").pop() ?? docId;
  const withoutExt = base.replace(/\.[^.]+$/, "");
  return tokenize(withoutExt.replace(/[-_]+/g, " "));
}

function sentenceScore(questionTokens: readonly string[], sentence: string, docId: string): number {
  const sentenceTokens = new Set(tokenize(sentence));
  let score = 0;
  for (const token of questionTokens) {
    if (sentenceTokens.has(token)) score += 1;
  }
  if (score === 0) return 0;
  const names = filenameTokens(docId);
  if (questionTokens.some((token) => names.includes(token))) score += 0.5;
  return score;
}

/**
 * Rank sentences across the corpus. Higher overlap wins.
 * Equal scores keep the alphabetically first document, then the earlier sentence.
 */
export function retrieve(question: string, docs: readonly Doc[]): RetrievalHit | null {
  const questionTokens = unique(tokenize(question));
  if (questionTokens.length === 0) return null;
  const ordered = docs.slice().sort((a, b) => a.id.localeCompare(b.id));
  let best: RetrievalHit | null = null;
  for (const doc of ordered) {
    for (const sentence of splitSentences(doc.text)) {
      const score = sentenceScore(questionTokens, sentence, doc.id);
      if (score <= 0) continue;
      if (!best || score > best.score) {
        best = { docId: doc.id, sentence, score };
      }
    }
  }
  return best;
}

export function refusalContent(markers: readonly string[] | undefined): string {
  let text = REFUSAL_TEXT;
  for (const marker of markers ?? []) {
    if (!containsPhrase(text, marker)) text += ` ${marker}.`;
  }
  return text;
}

/** Build a deterministic answer. Refusal follows the case flag. Other answers are retrieved sentences. */
export function mockAnswer(
  question: string,
  docs: readonly Doc[],
  options: MockAnswerOptions = {},
): ModelResponse {
  if (options.refuse) {
    return { content: refusalContent(options.refuseMarkers), citations: [] };
  }
  const hit = retrieve(question, docs);
  if (!hit) {
    return { content: refusalContent(undefined), citations: [] };
  }
  const citation = normalizeCitation(hit.docId);
  return {
    content: `${hit.sentence}\n\nSources: ${hit.docId}`,
    citations: [citation],
  };
}

export function findCase(cases: readonly Case[], question: string): Case | undefined {
  const needle = question.trim();
  return cases.find((item) => item.question.trim() === needle);
}

export function buildChatCompletion(
  response: ModelResponse,
  model: string,
  id: string,
): Record<string, unknown> {
  return {
    id,
    object: "chat.completion",
    created: 0,
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: response.content,
          citations: response.citations,
        },
        finish_reason: "stop",
      },
    ],
    citations: response.citations,
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part) {
        const text = (part as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      }
      return "";
    })
    .join("");
}

export function questionFromMessages(messages: unknown): string {
  if (!Array.isArray(messages)) {
    throw new Error("messages must be an array");
  }
  let question = "";
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const record = message as { role?: unknown; content?: unknown };
    if (record.role !== "user") continue;
    question = messageText(record.content).trim();
  }
  if (!question) throw new Error("messages must include a user question");
  return question;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function errorBody(message: string): { error: { message: string; type: string } } {
  return { error: { message, type: "invalid_request_error" } };
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) throw new Error("payload too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export interface MockServer {
  url: string;
  close: () => Promise<void>;
}

/**
 * Local OpenAI-compatible server. Accepts `POST /v1/chat/completions` and `POST /chat/completions`.
 * The base URL returned in `url` already includes `/v1`.
 */
export function startMockServer(options: {
  docs: readonly Doc[];
  cases: readonly Case[];
  host?: string;
  port?: number;
}): Promise<MockServer> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;

  const server = createServer((req, res) => {
    void handleRequest(req, res, options.docs, options.cases).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (!res.headersSent) sendJson(res, 500, errorBody(message));
      else res.end();
    });
  });
  server.requestTimeout = 30_000;

  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      reject(error);
    };
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Mock server did not bind a TCP port"));
        return;
      }
      resolve({
        url: `http://${address.address}:${address.port}/v1`,
        close: () =>
          new Promise((closeResolve, closeReject) => {
            server.close((error) => (error ? closeReject(error) : closeResolve()));
          }),
      });
    });
  });
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  docs: readonly Doc[],
  cases: readonly Case[],
): Promise<void> {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const pathname = url.pathname.replace(/\/+$/, "") || "/";

  if (method === "GET" && pathname === "/health") {
    sendJson(res, 200, { status: "ok" });
    return;
  }

  const isCompletion = pathname === "/v1/chat/completions" || pathname === "/chat/completions";
  if (!isCompletion) {
    sendJson(res, 404, errorBody(`Unknown path ${pathname}`));
    return;
  }
  if (method !== "POST") {
    res.setHeader("allow", "POST");
    sendJson(res, 405, errorBody("Method not allowed"));
    return;
  }

  let raw: string;
  try {
    raw = await readBody(req);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message === "payload too large" ? 413 : 400;
    sendJson(res, status, errorBody(message));
    return;
  }

  let payload: unknown;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    sendJson(res, 400, errorBody("Request body must be JSON"));
    return;
  }
  if (!payload || typeof payload !== "object") {
    sendJson(res, 400, errorBody("Request body must be a JSON object"));
    return;
  }
  const body = payload as { model?: unknown; messages?: unknown };
  if (typeof body.model !== "string" || body.model.trim() === "") {
    sendJson(res, 400, errorBody("model is required"));
    return;
  }

  let question: string;
  try {
    question = questionFromMessages(body.messages);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, 400, errorBody(message));
    return;
  }

  const matched = findCase(cases, question);
  const response = mockAnswer(question, docs, {
    id: matched?.id,
    refuse: matched?.expect.refuse === true,
    refuseMarkers: matched?.expect.refuse_markers_any,
  });
  const safeId = (matched?.id ?? "adhoc").replace(/[^a-zA-Z0-9_-]+/g, "-");
  sendJson(res, 200, buildChatCompletion(response, body.model, `chatcmpl-mock-${safeId}`));
}

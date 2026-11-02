import { collectCitations } from "./citations.js";
import { EvalError } from "./errors.js";
import type { ModelResponse } from "./types.js";

export const DEFAULT_TIMEOUT_MS = 30_000;

export const SYSTEM_PROMPT = [
  "You answer questions about a fixed knowledge base.",
  "Use only that knowledge base.",
  "When you use a source, cite its filename.",
  "Put citations on their own line starting with 'Sources:' and separate filenames with commas.",
  "If the knowledge base does not contain the answer, do not guess.",
  "Say that you don't know and that there is insufficient information.",
].join(" ");

export function joinCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!trimmed) throw new EvalError("Base URL is empty");
  return `${trimmed}/chat/completions`;
}

export function stripUrlCredentials(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    url.username = "";
    url.password = "";
    for (const name of ["api_key", "apikey", "key", "token", "access_token"]) {
      url.searchParams.delete(name);
    }
    return url.toString();
  } catch {
    return baseUrl;
  }
}

function contentToString(content: unknown): string {
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

/** Read an OpenAI chat completion body, including common citation extensions. */
export function parseChatCompletion(payload: unknown): ModelResponse {
  if (!payload || typeof payload !== "object") {
    throw new EvalError("Chat completion payload was not an object");
  }
  const data = payload as {
    choices?: unknown;
    citations?: unknown;
  };
  if (!Array.isArray(data.choices) || data.choices.length === 0) {
    throw new EvalError("Chat completion payload had no choices");
  }
  const choice = data.choices[0];
  if (!choice || typeof choice !== "object") {
    throw new EvalError("Chat completion choice was not an object");
  }
  const message = (choice as { message?: unknown }).message;
  const record = message && typeof message === "object" ? (message as Record<string, unknown>) : {};
  const content = contentToString(record.content);
  const structured: unknown[] = [];
  if (Array.isArray(data.citations)) structured.push(...data.citations);
  if (Array.isArray(record.citations)) structured.push(...record.citations);
  if (Array.isArray(record.context)) structured.push(...record.context);
  return { content, citations: collectCitations(content, structured) };
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

export async function completeChat(options: {
  baseUrl: string;
  apiKey?: string;
  model: string;
  question: string;
  timeoutMs?: number;
}): Promise<ModelResponse> {
  const url = joinCompletionsUrl(options.baseUrl);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.apiKey) headers.authorization = `Bearer ${options.apiKey}`;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const safeUrl = stripUrlCredentials(url);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: options.model,
        temperature: 0,
        stream: false,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: options.question },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new EvalError(`Request to ${safeUrl} failed: ${message}`);
  }

  const text = await response.text();
  if (!response.ok) {
    throw new EvalError(`Endpoint ${safeUrl} returned ${response.status}: ${truncate(text, 500)}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new EvalError(`Endpoint ${safeUrl} returned a non-JSON body`);
  }
  return parseChatCompletion(json);
}

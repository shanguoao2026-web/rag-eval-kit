import assert from "node:assert/strict";
import test from "node:test";

import { citationsMatch, extractCitationsFromText } from "../src/citations.js";
import { joinCompletionsUrl, parseChatCompletion, stripUrlCredentials } from "../src/client.js";

test("extracts Sources lines, brackets, and bare filenames", () => {
  const found = extractCitationsFromText(
    "See [refund-policy.md] for details.\nSources: shipping.md, privacy.md and notes.txt",
  );
  assert.ok(found.some((item) => item.includes("refund-policy.md")));
  assert.ok(found.some((item) => item.includes("shipping.md")));
  assert.ok(found.some((item) => item.includes("privacy.md")));
  assert.ok(found.some((item) => item.includes("notes.txt")));
});

test("parseChatCompletion merges structured citations and dedupes text", () => {
  const parsed = parseChatCompletion({
    citations: ["shipping.md"],
    choices: [
      {
        message: {
          role: "assistant",
          content: "See refund-policy.md\nSources: shipping.md",
          citations: [{ doc_id: "privacy.md" }],
          context: [{ metadata: { source: "guides/support-hours.md" } }],
        },
      },
    ],
  });
  assert.deepEqual(parsed.citations, [
    "shipping.md",
    "privacy.md",
    "guides/support-hours.md",
    "refund-policy.md",
  ]);
});

test("citationsMatch treats path suffix and basename as the same document", () => {
  assert.equal(citationsMatch("refund-policy.md", "docs/refund-policy.md"), true);
  assert.equal(citationsMatch("Refund-Policy.md", "refund-policy.md"), true);
  assert.equal(citationsMatch("notes.md", "release-notes.md"), false);
});

test("parseChatCompletion rejects payloads without choices", () => {
  assert.throws(() => parseChatCompletion({ choices: [] }), /no choices/);
  assert.throws(() => parseChatCompletion(null), /not an object/);
});

test("joinCompletionsUrl trims slashes and appends the chat path", () => {
  assert.equal(
    joinCompletionsUrl("http://127.0.0.1:8080/v1"),
    "http://127.0.0.1:8080/v1/chat/completions",
  );
  assert.equal(
    joinCompletionsUrl("http://127.0.0.1:8080/v1/"),
    "http://127.0.0.1:8080/v1/chat/completions",
  );
  assert.equal(
    joinCompletionsUrl("http://127.0.0.1:8080"),
    "http://127.0.0.1:8080/chat/completions",
  );
});

test("stripUrlCredentials removes userinfo and key query params", () => {
  const stripped = stripUrlCredentials("http://user:super-secret@127.0.0.1:8080/v1?api_key=super-secret");
  assert.equal(stripped.includes("super-secret"), false);
  assert.match(stripped, /^http:\/\/127\.0\.0\.1:8080\/v1/);
});

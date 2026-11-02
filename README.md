# rag-eval-kit

`rag-eval-kit` scores an OpenAI-compatible RAG or chat completions endpoint on three things:

1. **Answer quality** — case-insensitive phrase checks, plus an optional token-overlap check. No embeddings.
2. **Citation correctness** — whether the reply cites the expected document ids or filenames.
3. **Refusal behavior** — whether unanswerable questions are refused, and answerable ones are not.

It prints a terminal summary and writes a self-contained HTML report. A built-in mock answers from a local folder of markdown and text, so `npm test` and `rag-eval-kit run --mock` never need a network connection or an API key.

## Install

Node.js 20 or newer.

```bash
npm install
npm run build
```

The CLI is `dist/src/cli.js`. After `npm link` or `npx`, the command name is `rag-eval-kit`.

```bash
node dist/src/cli.js --help
```

## Quick start

Write a sample knowledge base and question set into the current directory:

```bash
rag-eval-kit init-sample
rag-eval-kit run --docs ./docs --cases ./cases.yaml --out ./report.html --mock
```

`init-sample` will not overwrite existing files unless you pass `--force`.

A run that passes every case exits 0. Any case with a score below 1 exits 1. Bad input or an endpoint error exits 2.

## Live endpoint

Point the CLI at any server that implements `POST {base}/chat/completions`. Flags override environment variables.

```bash
export RAG_EVAL_BASE_URL=https://my-rag.example.com/v1
export RAG_EVAL_API_KEY=sk-your-key
export RAG_EVAL_MODEL=my-model

rag-eval-kit run --docs ./docs --cases ./cases.yaml --out ./report.html
```

The same values can be passed as `--base-url`, `--api-key`, and `--model`.

The key is sent as `Authorization: Bearer …`. It is not printed and it is not written into the HTML report. Userinfo and common key query parameters are stripped from the URL stored in the report.

`--docs` is still required for a live run. The tool records which corpus the questions were written against. It does **not** upload those files. The endpoint is expected to do its own retrieval. `--mock` is what reads the files and answers locally.

Each request is a non-streaming chat completion with `temperature: 0`:

```json
{
  "model": "my-model",
  "temperature": 0,
  "stream": false,
  "messages": [
    {
      "role": "system",
      "content": "You answer questions about a fixed knowledge base. Use only that knowledge base. When you use a source, cite its filename. Put citations on their own line starting with 'Sources:' and separate filenames with commas. If the knowledge base does not contain the answer, do not guess. Say that you don't know and that there is insufficient information."
    },
    { "role": "user", "content": "What is the refund window?" }
  ]
}
```

Citations are read from, in order:

- the top-level `citations` array
- `choices[0].message.citations`
- `choices[0].message.context` (including `metadata.source` / `metadata.filename`)
- the answer text

String citations and objects with `doc_id`, `docId`, `filename`, `file`, `source`, `path`, or `id` are accepted. In the answer text, a `Sources:`, `Citations:`, or `References:` line is split on commas, and filenames ending in `.md`, `.markdown`, `.txt`, or `.text` are picked up anywhere in the reply.

```text
The refund window is 30 days.

Sources: refund-policy.md
```

## CLI

```text
rag-eval-kit run --docs <dir> --cases <file> --out <report.html> [options]
rag-eval-kit init-sample [--force]
rag-eval-kit --help
rag-eval-kit --version
```

| Option | Meaning |
| --- | --- |
| `--docs` | Folder of `.md`, `.markdown`, `.txt`, and `.text` files. Nested folders are included. Dotfiles and symlinks are skipped. A single file larger than 5MB is rejected. |
| `--cases` | YAML question set, schema version 1. |
| `--out` | HTML report path. Parent directories are created. The write is atomic. |
| `--mock` | Answer from `--docs` with the built-in retriever. No HTTP call. |
| `--base-url` | OpenAI-compatible origin, usually ending in `/v1`. Env: `RAG_EVAL_BASE_URL`. |
| `--api-key` | Bearer token. Env: `RAG_EVAL_API_KEY`. Optional when the server does not need one. |
| `--model` | Model id. Env: `RAG_EVAL_MODEL`. Required for live runs. Mock default: `rag-eval-mock`. |
| `--timeout-ms` | Per-request timeout. Default: 30000. |
| `--force` | Let `init-sample` overwrite files it would have created. |

Cases run one at a time. Progress goes to stderr. The summary goes to stdout.

## Question set

```yaml
version: 1
cases:
  - id: q1
    question: "What is the refund window?"
    expect:
      contains_any: ["30 days", "thirty days"]
      citations_any: ["refund-policy.md"]
      refuse: false
  - id: q2
    question: "Who is the CEO of Acme?"
    expect:
      refuse: true
      refuse_markers_any: ["don't know", "not in", "insufficient", "cannot find", "no information"]
```

`version` must be `1`. `cases` must be a non-empty list. Ids and questions are trimmed and must be unique. Unknown keys are rejected so a typo such as `citation_any` fails fast.

### `expect` fields

| Field | Required | Meaning |
| --- | --- | --- |
| `contains_any` | no | Passes when the answer contains at least one phrase. |
| `contains_all` | no | Passes when the answer contains every phrase. |
| `expected_answer` | no | Reference text for token overlap. |
| `overlap_min` | no | Minimum overlap, from 0 to 1. Default `0.5`. Requires `expected_answer`. |
| `citations_any` | no | Passes when at least one expected doc id is cited. |
| `citations_all` | no | Passes when every expected doc id is cited. |
| `refuse` | no | `true` if the model must refuse. Omitted means it must not refuse. |
| `refuse_markers_any` | no | Phrases that count as a refusal. If omitted, a built-in list is used. |

Phrase checks are exact substring checks after lowercasing, curly-quote folding, and whitespace collapsing. `30 days` matches `30   Days`. They are not regular expressions.

An empty `expect` is valid. It only checks that the answer does not look like a refusal.

The sample set in `fixtures/cases.yaml` adds shipping, privacy, and support questions on top of the two cases above. `fixtures/sample-docs/faq.md` is a distractor so retrieval has to rank, not just find a shared word.

## Scoring

Each case gets:

| Field | Meaning |
| --- | --- |
| `answer_pass` | Every configured answer check passed. `true` when the case has no answer checks. |
| `citation_pass` | Citation checks passed, or `null` when the case expects no citations. |
| `refuse_pass` | The reply refused if and only if `expect.refuse` is true. |
| `score` | Mean of the checks that apply, from 0 to 1. |

A check applies when:

- **Answer** — `contains_any`, `contains_all`, or `expected_answer` is set.
- **Citation** — `citations_any` or `citations_all` is set. Otherwise `citation_pass` is `null` and the check is left out of the score.
- **Refusal** — always.

If both `citations_any` and `citations_all` are set, both must pass. The same is true for the answer checks.

**Token overlap** is `|tokens(expected) ∩ tokens(answer)| / |tokens(expected)|`. Tokens are lowercase alphanumeric runs. A one-character token is kept only when it contains a digit, so `5` in `3-5` still counts. A small English stopword list (`the`, `what`, `is`, `of`, …) is removed. Stopwords are not removed from phrase checks.

**Citation match** is case-insensitive. These all match `refund-policy.md`:

- `refund-policy.md`
- `docs/refund-policy.md`
- `Refund-Policy.MD`

The match is equality, equal basenames, or one path ending with `/` plus the other. `notes.md` does not match `release-notes.md`.

**Refusal** is a substring check against `refuse_markers_any`, or against this default list:

- don't know
- do not know
- insufficient information
- not enough information
- no information
- cannot find
- can't find
- unable to answer
- cannot answer
- not in the provided
- no relevant information

The defaults are full phrases. A short fragment such as `not in` is easy to hit inside a normal sentence, so it is used only when a case lists it.

**Overall numbers**

- Mean score: unweighted average of case scores.
- Answer pass rate: among cases that have an answer check.
- Citation pass rate: among cases that expect citations.
- Refusal pass rate: every case.
- Full pass: score is exactly 1.

The HTML report opens with a failure count, lists every failed case expanded, then a table of all cases. Styling is in a `<style>` block. There are no external assets. A JSON copy of the report sits in `<script type="application/json" id="rag-eval-data">`.

## Mock mode

`--mock` does not call the network.

- If the case has `expect.refuse: true`, the mock returns a fixed refusal and no citations. The refusal text includes every default marker, and any case marker that is not already in that text. This is so an offline run checks the scorer and the report, not a live model.
- Otherwise it ranks sentences in `--docs` by keyword overlap with the question, adds a small bonus when the filename shares a token, and answers with the winning sentence plus `Sources: <filename>`. Ties keep the alphabetically first file, then the earlier sentence.
- If nothing matches, it refuses.

The factual path does not read `contains_any`, `contains_all`, or `expected_answer`. The sentence has to actually be in a document.

The same answerer is available as a local HTTP server (`startMockServer`) for tests. It accepts `POST /v1/chat/completions` and `POST /chat/completions` and returns an OpenAI chat completion object. `created` is `0` so the body stays deterministic.

## Programmatic use

```ts
import { renderHtml, runEval } from "rag-eval-kit";
import { writeFile } from "node:fs/promises";

const report = await runEval({
  docsPath: "./docs",
  casesPath: "./cases.yaml",
  mock: true,
});

await writeFile("report.html", renderHtml(report));
console.log(report.summary.mean_score);
```

Also exported: `loadDocs`, `loadQuestionSet`, `parseQuestionSet`, `scoreCase`, `summarize`, `mockAnswer`, `retrieve`, `startMockServer`, `completeChat`, `parseChatCompletion`, `renderTerminal`, `initSample`, `DEFAULT_REFUSE_MARKERS`, `DEFAULT_OVERLAP_MIN`, `SYSTEM_PROMPT`.

## Development

```bash
npm install
npm test
```

`npm test` compiles TypeScript and runs `node --test`. The suite starts a mock server on `127.0.0.1` and does not use the network or an API key. There are no secrets in this repository. Copy `.env.example` if you want a local live run.

## License

MIT. See [LICENSE](LICENSE).

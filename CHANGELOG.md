# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-11-02

### Added

- `rag-eval-kit run` scores an OpenAI-compatible chat completions endpoint for answer phrases, citation filenames, and refusal behavior.
- `rag-eval-kit init-sample` writes a sample knowledge base and question set.
- `--mock` answers from local markdown and text files with deterministic keyword retrieval, and refuses cases marked `expect.refuse: true`.
- Self-contained HTML report and a terminal summary.
- Offline test suite, including a local mock chat completions server. No API key or network access is required.

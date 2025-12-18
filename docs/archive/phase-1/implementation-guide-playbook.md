# Implementation Guide Playbook (for Phase X)

Use this playbook to author a Phase implementation guide that another agent can execute step-by-step. The goal is to avoid ambiguity, catch edge cases early, and ensure security/quality are baked in.

## Structure for Each Step
- **Repo Prompt files**: list paths/line ranges to include.
- **Task Description**: concise scope of the change.
- **Execution Checklist**: concrete actions the agent must do (code, validation, paths, rules, tests, doc updates).
- **Failure Modes / How to handle**: common errors and expected responses/remediations.
- **Acceptance Criteria**: observable outcomes.
- **Tests**: automated (lint/unit) and manual, including any curl/scripts. Encourage small scripts for repeatability; avoid shipping dev-only scripts.
- **Token budget**: ensure each step fits within Repo Prompt limits.\n+  - Free Repo Prompt users typically have ~30k tokens; prefer **multiple small prompts** over one large one.\n+  - Use **line ranges** and only include the minimum necessary files/sections.

## Standard Passes (iterate)
1) **Architect/Engineer pass**: Completeness, data flow, interfaces, success/error paths, versioning/migrations, cross-file impacts (specs, docs).
2) **Security pass**: Auth/CORS, validation (types/limits), path traversal/symlink, permissions/ownership, logging (no secrets), dependency/tooling behaviors.
3) **Prompt clarity pass**: Is it copy/paste executable? Are status codes/JSON shapes defined? Are limits/allowlists/denylists explicit? Are rules and env requirements stated?
4) **Testing/lint pass**: Specify required commands (e.g., `npm run lint`, `npm run test`, `npm run build`), emulator checks, and any rule verification steps.
5) **Final re-read**: Would a fresh agent, with only this guide, be able to implement without guessing?

## Cross-Cutting Guidance
- **Rules/permissions**: State current rules and required changes; note emulator tests before deploy.
- **Logging/cleanup**: Call out removal of dev logs/TODOs; keep necessary audit logs on the server.
- **Docs**: Point to relevant specs (e.g., websocket-protocol), and note any doc updates needed.
- **Automation**: Where manual steps exist, suggest small scripts/curl commands to make verification repeatable.
- **Token budgets**: Keep each step within Repo Prompt limits.

## Optional Prompts for Self-Scrub
- “What could go wrong? List failure modes and expected responses.”
- “Are auth/validation/path-safety/rules explicit?”
- “What lint/tests/emulator steps must run?”
- “If I were a new agent, what would I guess? Remove the guesswork.”

## Hand-off
- After a phase is built, hand the guide (and this playbook) to the next agent while context is fresh.

## Examples / Where to start
- See `phase-1c-implementation-guide.md` for a fully elaborated guide with checklists/failure modes.
- For the next phase to implement, check `docs/README.md` (Implementation Phases section) and the latest phase guide. When starting a new phase, create `phase-<n>-implementation-guide.md` using this playbook.

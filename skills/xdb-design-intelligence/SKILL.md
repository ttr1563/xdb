---
name: xdb-design-intelligence
description: Research, plan, create, and evaluate evidence-backed web designs with XDB. Use when a request should produce or assess a web UI, Figma design, HTML concept, or consistent illustration style; do not activate for ordinary code-only changes without design judgment.
---

# XDB Design Intelligence

Use XDB as a traceable design workflow, not as an ungrounded layout generator. Preserve the path from request to retrieved knowledge, plan, artifacts, and human evaluation.

## Workflow

1. Read `design.config.json` and confirm the requested output mode is enabled.
2. When the XDB MCP server is available, call `xdb_classify_design_input`; otherwise send the raw request to `/api/hooks/design-input`. Stop the XDB workflow when the result is `non-design`.
3. Create a Design Request with audience, objective, concepts, exclusions, optional reference URLs, and `figma | html | both`.
   - If references are supplied, use `xdb_list_request_references` to inspect the queue. XDB does not fetch URLs. Inspect a source only when the current client is authorized to browse it, then record a concise, source-grounded analysis with `xdb_record_reference_analysis`.
   - Do not approve your own analysis implicitly. Use `xdb_review_request_reference` only when the user has asked for that decision or a human decision is already available. Finalize every reference before planning; only approved references enter retrieval.
4. Generate and inspect the Design Plan before creating external artifacts. Surface missing audience, objective, permissions, or target-file information rather than inventing it.
   - Select `local` for deterministic offline planning or `anthropic` for Claude planning. Read [Claude provider](references/claude-provider.md) before configuring or diagnosing Claude.
   - For comparison work, use `xdb_create_plan_family` to create distinct local `conservative`, `expressive`, and `conversion-led` candidates. Do not batch external providers without a confirmed budget.
5. Create the configured outputs:
   - HTML is generated locally and must be reviewed at desktop and mobile widths.
   - Figma requires an existing file and an authorized Figma connection. Read [Figma delivery](references/figma-delivery.md) before executing a generated Figma plan.
   - Illustration work must use a Style Profile and record both accepted and rejected candidates. Read [Illustration consistency](references/illustration-consistency.md) for that mode.
6. Treat automatic scores as structural evidence, not human taste. Capture human approval, rejection, revision, or pairwise preference with a reason.
7. Never mark an external artifact complete when its adapter is disconnected. Preserve the operation plan and report `blocked_external` or `partial`.
8. Supply a stable, operation-specific `idempotencyKey` to every MCP write tool. Reuse it only when retrying the same payload.
9. After a Figma write, record the inspected desktop/mobile evidence with `xdb_record_figma_delivery`. Do not mark the run complete from connection status alone.
10. Before using research data for training, call `xdb_get_dataset_snapshot` and preserve its snapshot hash. Import only rights-attributed JSON/JSONL records; use lifecycle exclusion for reversible quality decisions and deletion only for intentional data erasure.

## Invariants

- Reuse existing design-system components, variables, and styles before creating equivalents.
- Use semantic DTCG tokens in the shared plan. Keep tool-specific IDs in adapter artifacts.
- Keep secrets out of requests, artifacts, logs, and knowledge records.
- Record the actual planning provider and fallback state. Never describe a local fallback as Claude output.
- A reference without provenance and usage rights remains `trainingEligible: false`.
- Reference images are local uploads only. Do not make XDB fetch an arbitrary source URL; validate format and size before storage.
- Treat URL availability, design usefulness, and training rights as separate decisions. Public availability never implies `rightsStatus: verified` or `trainingEligible: true`.
- Do not average incompatible contexts into one universal style. Match knowledge by audience, objective, concept, platform, and artifact purpose.
- A generated screenshot is evidence for review, never a replacement for editable Figma structure or semantic HTML.

Read [Data contracts](references/data-contracts.md) only when creating integrations, importing data, or diagnosing validation failures.

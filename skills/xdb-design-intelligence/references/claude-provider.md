# Claude provider

Read this reference when Claude is selected for planning or when XDB is operated through Claude Code.

## Runtime planning

- `anthropic` is an optional planning provider; `local` remains available without network access.
- Require both `XDB_ANTHROPIC_API_KEY` and `XDB_ANTHROPIC_MODEL`. Do not infer a model name because model lifecycle and account availability change.
- Keep `allowExternalRequests` false until the user has confirmed the model, token ceiling, expected cost, and one-request live test. A credential alone does not authorize a call.
- Send the credential only after the HTTPS base URL matches `allowedBaseUrls`. Keep the official Anthropic endpoint as the sole default.
- Require a positive `monthlyTokenBudget`; zero means stopped. Treat it as a local preflight, not a provider-side billing cap.
- Retry only 429 and 5xx responses, within `maxRetries`. Do not retry timeout, other 4xx, network failure, or invalid tool output automatically.
- Treat the model response as an untrusted draft. Accept only the forced `submit_design_plan` tool result and validate it with the shared Zod contract.
- XDB owns IDs, request lineage, knowledge IDs, Style Profile ID, provider metadata, and timestamps.
- Record provider, model, token usage, latency, attempt count, error code, status, and fallback. Do not store the credential, full prompt, or full provider response in `ai_runs`.
- A local fallback must be visible in both `DesignPlan.generation` and `ai_runs`; never label it as Claude output.

## Claude Code

The repository `CLAUDE.md` imports the shared XDB Skill. Use the same HTTP API and contracts used by other agents. A future MCP facade may expose those APIs as tools, but its absence must not be represented as an active MCP connection.

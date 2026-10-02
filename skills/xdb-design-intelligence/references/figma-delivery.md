# Figma delivery

Use the generated `figma-plan` as intent and the generated `figma-script` as a construction starting point. They do not replace inspection of the target file.

Before mutation:

1. Confirm the target Figma file and write authorization.
2. Load the available Figma-use and full-page generation skills required by the environment.
3. Inspect pages, existing screens, Code Connect mappings, components, variables, styles, and product fonts.
4. Map each planned component to an existing component where possible.

During mutation:

- Build with Auto Layout and semantic variable bindings.
- Use the plan's run-bound operation key and desktop/mobile root names. Search every page. Replay only when exactly one of each root exists on the same page, recording them as observed rather than created/mutated nodes; otherwise stop for inspection.
- Return every created or mutated node ID.
- Keep desktop and mobile frames linked to the same design decisions.
- Do not paste the HTML preview as a flattened image.

After mutation:

- Capture one full desktop and one full mobile screenshot.
- Fail review on clipped text, overlap, missing images, placeholder copy, wrong fonts, or unresolved components.
- Record the Figma file key, node IDs, adapter result, and screenshot references in the Creation Run.
- Call `xdb_record_figma_delivery` (or `POST /api/figma-deliveries`) with both root structures and screenshot confirmation. A connection alone is never completion evidence.
- Treat a conflicting payload, a second completed operation, missing root evidence, clipped text, or placeholder text as a failed acceptance check.

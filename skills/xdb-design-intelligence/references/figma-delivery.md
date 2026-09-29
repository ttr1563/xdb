# Figma delivery

Use the generated `figma-plan` as intent and the generated `figma-script` as a construction starting point. They do not replace inspection of the target file.

Before mutation:

1. Confirm the target Figma file and write authorization.
2. Load the available Figma-use and full-page generation skills required by the environment.
3. Inspect pages, existing screens, Code Connect mappings, components, variables, styles, and product fonts.
4. Map each planned component to an existing component where possible.

During mutation:

- Build with Auto Layout and semantic variable bindings.
- Return every created or mutated node ID.
- Keep desktop and mobile frames linked to the same design decisions.
- Do not paste the HTML preview as a flattened image.

After mutation:

- Capture one full desktop and one full mobile screenshot.
- Fail review on clipped text, overlap, missing images, placeholder copy, wrong fonts, or unresolved components.
- Record the Figma file key, node IDs, adapter result, and screenshot references in the Creation Run.

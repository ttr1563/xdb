# Illustration consistency

Create an Illustration Spec from an existing Style Profile before calling an image generator.

The spec must define purpose, subject, aspect ratio, focal point, copy-safe area, required traits, and exclusions. Retrieve approved references from the same style and artifact purpose; do not blend unrelated style clusters.

Record for every candidate:

- generator and model/version when exposed;
- prompt-compiler version;
- dimensions, seed when exposed, and reference roles;
- technical validation;
- style, brand, composition, and layout-usability scores;
- human decision and reason.

Reject an otherwise attractive image when it breaks copy-safe areas, mobile cropping, the approved palette, subject clarity, or the style profile. Seed reuse alone does not guarantee reproducibility across provider or model changes.

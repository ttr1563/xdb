# XDB data contracts

The canonical Zod contracts live in `src/shared/contracts.ts`. JSON Schema intended for external configuration lives under `schemas/`.

Core lineage:

```text
DesignRequest
  -> DesignPlan
    -> CreationRun
      -> Artifact
        -> Evaluation / PairwiseComparison
```

Keep these identifiers stable when exporting or importing records. Store timestamps as ISO 8601 UTC strings.

## Knowledge

Every knowledge item contains:

- contexts and concepts for retrieval;
- evidence explaining why the item exists;
- provenance with source type, source URI, license, capture time, and training eligibility.

Do not infer `trainingEligible: true` from public availability.

## Scores

Scores use 1–5 values and remain dimensional. Never replace the dimensions with one unlabeled average. Human and automatic evaluator types must remain distinguishable.

## Tool state

Creation status meanings:

- `completed`: every requested adapter produced its expected artifact;
- `partial`: at least one requested adapter completed and another is externally blocked;
- `blocked_external`: no requested visual output could be executed because authorization or connection is missing;
- `failed`: an in-scope adapter attempted work and failed validation or execution.

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

An optional research lineage branches before planning:

```text
DesignRequest -> RequestReference -> approved KnowledgeItem -> DesignPlan
```

`RequestReference` stores a canonical HTTP(S) URL, role (`inspiration | competitor | avoid | existing`), optional note, analysis, final decision, and optional Knowledge ID. Its state is `pending → analyzed → approved | rejected | unavailable`. Approval requires analysis; final states are not edited in place. An approved `avoid` reference becomes an anti-pattern. XDB itself does not fetch the URL.

Keep these identifiers stable when exporting or importing records. Store timestamps as ISO 8601 UTC strings.

## Knowledge

Every knowledge item contains:

- contexts and concepts for retrieval;
- evidence explaining why the item exists;
- provenance with source type, source URI, license, rights status, capture time, and training eligibility;
- lifecycle state (`active | excluded | deleted`) and an auditable reason;
- a metadata fingerprint plus optional duplicate lineage and import batch ID.

Normalize context aliases through the canonical taxonomy before fingerprinting. Retrieval accepts only active, non-duplicate records. A training snapshot additionally requires `rightsStatus: verified` and `trainingEligible: true`. Do not infer either field from public availability.

Imports accept a JSON array or one JSON object per JSONL line, with at most 500 candidates per request. Validation is row-scoped; retain the batch counts and indexed errors. Reference images are a separate local multipart upload and never a server-side URL fetch. Only JPEG, PNG, and WebP up to 8 MiB and 40 megapixels are accepted.

`exclude` is reversible. `delete` is not: replace content and provenance with a tombstone, prohibit training, and remove the associated reference file and metadata. Do not restore deleted records.

## Scores

Scores use 1–5 values and remain dimensional. Never replace the dimensions with one unlabeled average. Human and automatic evaluator types must remain distinguishable.

## Tool state

Creation status meanings:

- `completed`: every requested adapter produced its expected artifact;
- `partial`: at least one requested adapter completed and another is externally blocked;
- `blocked_external`: no requested visual output could be executed because authorization or connection is missing;
- `failed`: an in-scope adapter attempted work and failed validation or execution.

import { z } from 'zod';

export const outputModeSchema = z.enum(['figma', 'html', 'both']);
export type OutputMode = z.infer<typeof outputModeSchema>;

export const aiProviderSchema = z.enum(['local', 'anthropic']);
export type AiProvider = z.infer<typeof aiProviderSchema>;

export const designConfigSchema = z.object({
  version: z.literal(1),
  output: z.object({
    defaultMode: outputModeSchema,
    availableModes: z.array(outputModeSchema).min(1),
  }),
  ai: z.object({
    defaultProvider: aiProviderSchema,
    providers: z.object({
      local: z.object({ enabled: z.boolean() }),
      anthropic: z.object({
        enabled: z.boolean(),
        fallbackToLocal: z.boolean(),
        timeoutMs: z.number().int().min(1_000).max(120_000),
        maxOutputTokens: z.number().int().min(256).max(32_000),
      }),
    }),
  }),
  figma: z.object({
    enabled: z.boolean(),
    requireExistingFile: z.boolean(),
    reuseExistingComponents: z.boolean(),
    reuseExistingVariables: z.boolean(),
  }),
  html: z.object({
    enabled: z.boolean(),
    format: z.literal('standalone'),
    responsive: z.boolean(),
    accessibilityTarget: z.literal('WCAG-AA'),
  }),
  illustration: z.object({
    enabled: z.boolean(),
    candidateCount: z.number().int().min(1).max(8),
    requireHumanApproval: z.boolean(),
    storeRejectedCandidates: z.boolean(),
  }),
  evaluation: z.object({
    automatic: z.boolean(),
    pairwiseComparison: z.boolean(),
    requireHumanReview: z.boolean(),
  }),
  knowledge: z.object({
    recordProvenance: z.boolean(),
    recordRejectedDesigns: z.boolean(),
  }),
});
export type DesignConfig = z.infer<typeof designConfigSchema>;

export const designIntentSchema = z.enum([
  'create-design',
  'evaluate-design',
  'research-design',
  'create-illustration',
  'non-design',
]);
export type DesignIntent = z.infer<typeof designIntentSchema>;

export const provenanceSchema = z.object({
  sourceType: z.enum(['human', 'system', 'url', 'figma', 'html', 'generated']),
  sourceUri: z.string().url().nullable().default(null),
  license: z.string().min(1).nullable().default(null),
  trainingEligible: z.boolean().default(false),
  capturedAt: z.string().datetime(),
});
export type Provenance = z.infer<typeof provenanceSchema>;

export const scoreSetSchema = z.object({
  hierarchy: z.number().min(1).max(5),
  clarity: z.number().min(1).max(5),
  composition: z.number().min(1).max(5),
  typography: z.number().min(1).max(5),
  color: z.number().min(1).max(5),
  spacing: z.number().min(1).max(5),
  conceptFit: z.number().min(1).max(5),
  distinctiveness: z.number().min(1).max(5),
  accessibility: z.number().min(1).max(5),
  implementability: z.number().min(1).max(5),
});
export type ScoreSet = z.infer<typeof scoreSetSchema>;

export const illustrationScoreSetSchema = z.object({
  semanticAccuracy: z.number().min(1).max(5),
  styleConsistency: z.number().min(1).max(5),
  composition: z.number().min(1).max(5),
  brandFit: z.number().min(1).max(5),
  technicalQuality: z.number().min(1).max(5),
  layoutUsability: z.number().min(1).max(5),
  distinctiveness: z.number().min(1).max(5),
});
export type IllustrationScoreSet = z.infer<typeof illustrationScoreSetSchema>;

export const knowledgeInputSchema = z.object({
  title: z.string().min(2).max(140),
  summary: z.string().min(8).max(2_000),
  kind: z.enum(['principle', 'pattern', 'reference', 'anti-pattern']),
  contexts: z.array(z.string().min(1).max(80)).min(1).max(20),
  concepts: z.array(z.string().min(1).max(80)).min(1).max(20),
  evidence: z.string().min(4).max(2_000),
  provenance: provenanceSchema,
});
export type KnowledgeInput = z.infer<typeof knowledgeInputSchema>;

export const knowledgeItemSchema = knowledgeInputSchema.extend({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
});
export type KnowledgeItem = z.infer<typeof knowledgeItemSchema>;

export const designRequestInputSchema = z.object({
  prompt: z.string().min(12).max(8_000),
  projectName: z.string().min(2).max(120),
  audience: z.string().min(2).max(500),
  objective: z.string().min(2).max(500),
  concepts: z.array(z.string().min(1).max(80)).min(1).max(12),
  avoid: z.array(z.string().min(1).max(120)).max(12).default([]),
  outputMode: outputModeSchema,
});
export type DesignRequestInput = z.infer<typeof designRequestInputSchema>;

export const designRequestSchema = designRequestInputSchema.extend({
  id: z.string().uuid(),
  intent: designIntentSchema.exclude(['non-design']),
  status: z.enum(['draft', 'planned', 'generated', 'reviewed']),
  createdAt: z.string().datetime(),
});
export type DesignRequest = z.infer<typeof designRequestSchema>;

const tokenValueSchema = z.union([
  z.string(),
  z.number(),
  z.object({
    value: z.number(),
    unit: z.enum(['px', 'rem']),
  }),
]);

export const designTokenSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['color', 'dimension', 'fontFamily', 'fontWeight', 'duration']),
  value: tokenValueSchema,
  description: z.string().min(1),
});
export type DesignToken = z.infer<typeof designTokenSchema>;

export const illustrationSpecSchema = z.object({
  purpose: z.enum(['hero', 'feature', 'empty-state', 'background', 'icon']),
  subject: z.string().min(3),
  styleProfileId: z.string().uuid(),
  aspectRatio: z.enum(['16:9', '4:3', '3:2', '1:1']),
  focalPoint: z.enum(['left', 'center', 'right']),
  safeArea: z.enum(['left', 'right', 'top', 'none']),
  required: z.array(z.string()).min(1),
  avoid: z.array(z.string()),
});
export type IllustrationSpec = z.infer<typeof illustrationSpecSchema>;

export const designSectionSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['navigation', 'hero', 'trust', 'features', 'workflow', 'pricing', 'faq', 'cta', 'footer']),
  purpose: z.string().min(3),
  component: z.string().min(1),
  variant: z.string().min(1),
  headline: z.string().min(1),
  body: z.string().min(1),
});
export type DesignSection = z.infer<typeof designSectionSchema>;

export const designPlanSchema = z.object({
  id: z.string().uuid(),
  requestId: z.string().uuid(),
  version: z.literal(1),
  rationale: z.string().min(20),
  designDirection: z.object({
    primaryConcept: z.string().min(1),
    secondaryConcepts: z.array(z.string()),
    density: z.enum(['low', 'medium', 'high']),
    contrast: z.enum(['soft', 'moderate', 'strong']),
    shape: z.enum(['precise', 'balanced', 'soft']),
    motion: z.enum(['none', 'subtle', 'expressive']),
  }),
  sections: z.array(designSectionSchema).min(3),
  tokens: z.array(designTokenSchema).min(8),
  illustration: illustrationSpecSchema.nullable(),
  knowledgeIds: z.array(z.string().uuid()),
  generation: z.object({
    provider: aiProviderSchema,
    model: z.string().min(1),
    fallbackUsed: z.boolean(),
  }),
  createdAt: z.string().datetime(),
});
export type DesignPlan = z.infer<typeof designPlanSchema>;

export const aiRunSchema = z.object({
  id: z.string().uuid(),
  requestId: z.string().uuid(),
  purpose: z.literal('planning'),
  provider: aiProviderSchema,
  model: z.string().min(1).nullable(),
  status: z.enum(['completed', 'fallback', 'failed']),
  fallbackUsed: z.boolean(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  latencyMs: z.number().int().nonnegative(),
  error: z.string().max(1_000).nullable(),
  createdAt: z.string().datetime(),
});
export type AiRun = z.infer<typeof aiRunSchema>;

export const styleProfileInputSchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().min(8).max(1_000),
  medium: z.string().min(2).max(100),
  traits: z.array(z.string().min(1).max(100)).min(3).max(20),
  palette: z.array(z.string().regex(/^#[0-9A-Fa-f]{6}$/)).min(2).max(8),
  compositionRules: z.array(z.string().min(2).max(160)).min(1).max(12),
  forbiddenTraits: z.array(z.string().min(2).max(160)).min(1).max(20),
});
export type StyleProfileInput = z.infer<typeof styleProfileInputSchema>;

export const styleProfileSchema = styleProfileInputSchema.extend({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
});
export type StyleProfile = z.infer<typeof styleProfileSchema>;

export const creationRunInputSchema = z.object({
  planId: z.string().uuid(),
  outputMode: outputModeSchema,
  figmaFileKey: z.string().min(1).max(256).nullable().default(null),
});
export type CreationRunInput = z.infer<typeof creationRunInputSchema>;

export const artifactSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  kind: z.enum(['html', 'figma-plan', 'figma-script', 'illustration-spec', 'report']),
  path: z.string().min(1),
  sha256: z.string().length(64),
  createdAt: z.string().datetime(),
});
export type Artifact = z.infer<typeof artifactSchema>;

export const creationRunSchema = creationRunInputSchema.extend({
  id: z.string().uuid(),
  status: z.enum(['completed', 'partial', 'blocked_external', 'failed']),
  summary: z.string(),
  artifacts: z.array(artifactSchema),
  createdAt: z.string().datetime(),
});
export type CreationRun = z.infer<typeof creationRunSchema>;

export const evaluationInputSchema = z.object({
  artifactId: z.string().uuid(),
  evaluatorType: z.enum(['human', 'automatic']),
  scores: scoreSetSchema,
  rationale: z.string().min(4).max(2_000),
  decision: z.enum(['approved', 'rejected', 'revise']),
});
export type EvaluationInput = z.infer<typeof evaluationInputSchema>;

export const evaluationSchema = evaluationInputSchema.extend({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
});
export type Evaluation = z.infer<typeof evaluationSchema>;

export const comparisonInputSchema = z.object({
  requestId: z.string().uuid(),
  artifactAId: z.string().uuid(),
  artifactBId: z.string().uuid(),
  preferredArtifactId: z.string().uuid(),
  rationale: z.string().min(4).max(2_000),
});
export type ComparisonInput = z.infer<typeof comparisonInputSchema>;

export const inputHookSchema = z.object({
  input: z.string().min(1).max(8_000),
});

export const inputHookResultSchema = z.object({
  intent: designIntentSchema,
  confidence: z.number().min(0).max(1),
  suggestedAction: z.enum(['research', 'plan', 'create', 'illustrate', 'ignore']),
  signals: z.array(z.string()),
});
export type InputHookResult = z.infer<typeof inputHookResultSchema>;

export interface DashboardSummary {
  requests: number;
  knowledgeItems: number;
  plans: number;
  creationRuns: number;
  evaluations: number;
  approvedArtifacts: number;
}

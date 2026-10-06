import { createHash, randomUUID } from 'node:crypto';

import type {
  AiProvider,
  ComparisonInput,
  ContextTaxonomyInput,
  ContextTaxonomyTerm,
  CreationRun,
  CreationRunInput,
  DesignPlan,
  DesignRequest,
  DesignRequestInput,
  Evaluation,
  EvaluationInput,
  FigmaDelivery,
  FigmaDeliveryInput,
  InputHookResult,
  KnowledgeImportBatch,
  KnowledgeImportInput,
  KnowledgeInput,
  KnowledgeItem,
  KnowledgeLifecycleInput,
  PlanFamily,
  PlanFamilyInput,
  ReferenceAsset,
  RequestReference,
  RequestReferenceAnalysisInput,
  RequestReferenceReviewInput,
} from '../../shared/contracts.js';
import { knowledgeInputSchema } from '../../shared/contracts.js';
import { generateDesignPlan } from '../ai/planning.js';
import { ReferenceAssetStore } from '../artifacts/reference-store.js';
import type { ArtifactStore } from '../artifacts/store.js';
import type { RuntimeConfig } from '../config.js';
import type { Repository } from '../db/repository.js';
import { executeCreation } from '../domain/creation.js';
import { classifyDesignInput } from '../domain/intent.js';
import { knowledgeMetadataFingerprint, perceptualHashDistance } from '../domain/knowledge-quality.js';
import { rankKnowledge } from '../domain/knowledge-ranking.js';
import { knowledgeSeeds, styleProfileSeeds } from '../domain/seeds.js';

export class ApplicationError extends Error {
  public constructor(
    name: string,
    public readonly statusCode: number,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = name;
  }
}

export interface XdbServiceDependencies {
  repository: Repository;
  config: RuntimeConfig;
  artifactStore: ArtifactStore;
  referenceAssetStore?: ReferenceAssetStore;
}

export function seedXdbRepository(repository: Repository): void {
  if (repository.listKnowledge().length === 0) {
    for (const seed of knowledgeSeeds) repository.createKnowledge(seed);
  }
  if (repository.listStyleProfiles().length === 0) {
    for (const seed of styleProfileSeeds) repository.createStyleProfile(seed);
  }
}

export class XdbService {
  public constructor(private readonly dependencies: XdbServiceDependencies) {}

  private get referenceAssetStore(): ReferenceAssetStore {
    return this.dependencies.referenceAssetStore ?? new ReferenceAssetStore(this.dependencies.config.artifactsPath);
  }

  public classify(input: string): InputHookResult {
    return classifyDesignInput(input);
  }

  public searchKnowledge(requestId: string): KnowledgeItem[] {
    const request = this.requireRequest(requestId);
    const items = this.dependencies.repository.listRetrievableKnowledge();
    const linkedIds = new Set(request.references
      .filter((reference) => reference.status === 'approved' && reference.knowledgeId !== null)
      .map((reference) => reference.knowledgeId));
    const linked = items.filter((item) => linkedIds.has(item.id));
    const linkedItemIds = new Set(linked.map((item) => item.id));
    return [...linked, ...rankKnowledge(request, items).filter((item) => !linkedItemIds.has(item.id))].slice(0, 6);
  }

  public recordRequestReferenceAnalysis(
    id: string,
    input: RequestReferenceAnalysisInput,
  ): RequestReference {
    const reference = this.dependencies.repository.getRequestReference(id);
    if (!reference) throw new ApplicationError('request_reference_not_found', 404, 'The request reference was not found.');
    if (!['pending', 'analyzed'].includes(reference.status)) {
      throw new ApplicationError('request_reference_finalized', 409, 'Finalized request references cannot be analyzed.');
    }
    const updated = this.dependencies.repository.recordRequestReferenceAnalysis(id, input);
    if (!updated) throw new ApplicationError('request_reference_conflict', 409, 'The request reference status changed.');
    return updated;
  }

  public reviewRequestReference(id: string, input: RequestReferenceReviewInput): RequestReference {
    const reference = this.dependencies.repository.getRequestReference(id);
    if (!reference) throw new ApplicationError('request_reference_not_found', 404, 'The request reference was not found.');
    if (!['pending', 'analyzed'].includes(reference.status)) {
      throw new ApplicationError('request_reference_finalized', 409, 'The request reference already has a final decision.');
    }
    if (input.decision === 'approved') {
      if (reference.status !== 'analyzed' || !reference.analysis) {
        throw new ApplicationError('request_reference_not_analyzed', 409, 'Analyze the reference before approval.');
      }
      const analysis = reference.analysis;
      const evidence = [analysis.evidence, ...analysis.strengths, ...analysis.risks.map((risk) => `Risk: ${risk}`)]
        .join('\n')
        .slice(0, 2_000);
      const knowledgeInput = knowledgeInputSchema.parse({
        title: analysis.title,
        summary: analysis.summary,
        kind: reference.role === 'avoid' ? 'anti-pattern' : 'reference',
        contexts: analysis.contexts,
        concepts: analysis.concepts,
        evidence,
        provenance: {
          sourceType: 'url',
          sourceUri: reference.url,
          license: analysis.license,
          rightsStatus: analysis.rightsStatus,
          trainingEligible: analysis.trainingEligible,
          capturedAt: new Date().toISOString(),
        },
      });
      const updated = this.dependencies.repository.approveRequestReference(id, input.reason, knowledgeInput);
      if (!updated) throw new ApplicationError('request_reference_conflict', 409, 'The request reference status changed.');
      return updated;
    }
    const updated = this.dependencies.repository.reviewRequestReference(
      id,
      input.decision,
      input.reason,
      null,
    );
    if (!updated) throw new ApplicationError('request_reference_conflict', 409, 'The request reference status changed.');
    return updated;
  }

  public createKnowledge(input: KnowledgeInput): KnowledgeItem {
    const contexts = this.dependencies.repository.resolveContexts(input.contexts);
    const fingerprint = knowledgeMetadataFingerprint(input, contexts);
    const duplicate = this.dependencies.repository.findKnowledgeByFingerprint(fingerprint);
    if (duplicate) {
      throw new ApplicationError('knowledge_duplicate', 409, 'Equivalent knowledge already exists.', {
        duplicateOfId: duplicate.id,
      });
    }
    return this.dependencies.repository.createKnowledge({ ...input, contexts });
  }

  public importKnowledge(input: KnowledgeImportInput): KnowledgeImportBatch {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    let createdCount = 0;
    let duplicateCount = 0;
    const errors: KnowledgeImportBatch['errors'] = [];
    this.dependencies.repository.saveKnowledgeImportBatch({
      id,
      format: input.format,
      status: 'running',
      totalCount: input.items.length,
      createdCount: 0,
      duplicateCount: 0,
      rejectedCount: 0,
      errors: [],
      createdAt,
    });
    input.items.forEach((candidate, index) => {
      const parsed = knowledgeInputSchema.safeParse(candidate);
      if (!parsed.success) {
        errors.push({
          index,
          code: 'validation_error',
          message: parsed.error.issues[0]?.message ?? 'Invalid knowledge item.',
        });
        return;
      }
      const contexts = this.dependencies.repository.resolveContexts(parsed.data.contexts);
      const fingerprint = knowledgeMetadataFingerprint(parsed.data, contexts);
      if (this.dependencies.repository.findKnowledgeByFingerprint(fingerprint)) {
        duplicateCount += 1;
        return;
      }
      this.dependencies.repository.createKnowledge({ ...parsed.data, contexts }, id);
      createdCount += 1;
    });
    const rejectedCount = errors.length;
    const status: KnowledgeImportBatch['status'] = createdCount === 0 && duplicateCount === 0
      ? 'failed'
      : rejectedCount > 0 ? 'partial' : 'completed';
    return this.dependencies.repository.saveKnowledgeImportBatch({
      id,
      format: input.format,
      status,
      totalCount: input.items.length,
      createdCount,
      duplicateCount,
      rejectedCount,
      errors,
      createdAt,
    });
  }

  public async updateKnowledgeLifecycle(id: string, input: KnowledgeLifecycleInput): Promise<KnowledgeItem> {
    const current = this.dependencies.repository.getKnowledge(id);
    if (!current) throw new ApplicationError('knowledge_not_found', 404, 'The knowledge item was not found.');
    if (current.lifecycle === 'deleted') {
      throw new ApplicationError('knowledge_deleted', 409, 'Deleted knowledge tombstones cannot be changed.');
    }
    if (input.action === 'delete') {
      const asset = this.dependencies.repository.getReferenceAssetForKnowledge(id);
      if (asset) await this.referenceAssetStore.remove(asset.storagePath);
    }
    const updated = this.dependencies.repository.updateKnowledgeLifecycle(id, input.action, input.reason);
    if (!updated) throw new ApplicationError('knowledge_not_found', 404, 'The knowledge item was not found.');
    return updated;
  }

  public createContextTaxonomy(input: ContextTaxonomyInput): ContextTaxonomyTerm {
    try {
      return this.dependencies.repository.createContextTaxonomy(input);
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        throw new ApplicationError('taxonomy_conflict', 409, 'The canonical context or one of its aliases already exists.');
      }
      throw error;
    }
  }

  public async uploadReferenceAsset(
    knowledgeId: string,
    buffer: Buffer,
    originalName: string,
    mimeType: string,
  ): Promise<{ asset: ReferenceAsset; duplicate: { knowledgeId: string; kind: 'exact-asset' | 'perceptual' } | null }> {
    const knowledge = this.dependencies.repository.getKnowledge(knowledgeId);
    if (!knowledge) throw new ApplicationError('knowledge_not_found', 404, 'The knowledge item was not found.');
    if (knowledge.lifecycle === 'deleted') throw new ApplicationError('knowledge_deleted', 409, 'Deleted knowledge cannot receive assets.');
    if (this.dependencies.repository.getReferenceAssetForKnowledge(knowledgeId)) {
      throw new ApplicationError('reference_asset_exists', 409, 'The knowledge item already has a reference asset.');
    }
    let prepared;
    try {
      prepared = await this.referenceAssetStore.prepare(buffer, originalName, mimeType);
    } catch (error) {
      throw new ApplicationError('reference_asset_invalid', 400, error instanceof Error ? error.message : 'Invalid image.');
    }
    const existingAssets = this.dependencies.repository.listReferenceAssets().filter((asset) => {
      const item = this.dependencies.repository.getKnowledge(asset.knowledgeId);
      return item?.lifecycle === 'active' && item.duplicateOfId === null;
    });
    const exact = existingAssets.find((asset) => asset.sha256 === prepared.sha256);
    const perceptual = exact ? undefined : existingAssets.find((asset) =>
      perceptualHashDistance(asset.perceptualHash, prepared.perceptualHash) <= 4,
    );
    const duplicate = exact
      ? { knowledgeId: exact.knowledgeId, kind: 'exact-asset' as const }
      : perceptual ? { knowledgeId: perceptual.knowledgeId, kind: 'perceptual' as const } : null;
    const stored = await this.referenceAssetStore.write(knowledgeId, prepared);
    const asset: ReferenceAsset = {
      ...stored,
      knowledgeId,
      originalName: prepared.originalName,
      mimeType: prepared.mimeType,
      byteSize: prepared.byteSize,
      width: prepared.width,
      height: prepared.height,
      sha256: prepared.sha256,
      perceptualHash: prepared.perceptualHash,
      createdAt: new Date().toISOString(),
    };
    try {
      return { asset: this.dependencies.repository.createReferenceAsset(asset, duplicate), duplicate };
    } catch (error) {
      await this.referenceAssetStore.remove(stored.storagePath);
      throw error;
    }
  }

  public datasetSnapshot(): {
    version: 1;
    createdAt: string;
    sha256: string;
    knowledge: KnowledgeItem[];
    taxonomy: ContextTaxonomyTerm[];
    referenceAssets: ReferenceAsset[];
  } {
    const knowledge = this.dependencies.repository.listTrainingKnowledge();
    const taxonomy = this.dependencies.repository.listContextTaxonomy();
    const knowledgeIds = new Set(knowledge.map((item) => item.id));
    const referenceAssets = this.dependencies.repository.listReferenceAssets()
      .filter((asset) => knowledgeIds.has(asset.knowledgeId));
    const createdAt = new Date().toISOString();
    const sha256 = createHash('sha256')
      .update(JSON.stringify({ version: 1, knowledge, taxonomy, referenceAssets }))
      .digest('hex');
    return { version: 1, createdAt, sha256, knowledge, taxonomy, referenceAssets };
  }

  public createRequest(input: DesignRequestInput): DesignRequest {
    const intent = this.classify(input.prompt);
    if (intent.intent === 'non-design') {
      throw new ApplicationError(
        'not_design_request',
        422,
        'The input was not classified as a design request.',
        { intent },
      );
    }
    return this.dependencies.repository.createRequest(input);
  }

  public async createPlan(requestId: string, provider: AiProvider): Promise<DesignPlan> {
    const request = this.requireRequest(requestId);
    this.assertRequestReferencesFinalized(request);
    const providerConfig = this.dependencies.config.design.ai.providers[provider];
    if (!providerConfig.enabled) {
      throw new ApplicationError(`${provider}_ai_provider_disabled`, 409, `${provider} AI provider is disabled.`);
    }
    const styleProfile = this.dependencies.repository.listStyleProfiles()[0];
    if (!styleProfile) throw new ApplicationError('style_profile_required', 409, 'A Style Profile is required.');
    const plan = await generateDesignPlan({
      provider,
      request,
      knowledge: this.searchKnowledge(requestId),
      styleProfile,
      config: this.dependencies.config,
      repository: this.dependencies.repository,
    });
    return this.dependencies.repository.savePlan(plan);
  }

  public async createPlanFamily(input: PlanFamilyInput): Promise<{ family: PlanFamily; plans: DesignPlan[] }> {
    if (!this.dependencies.config.design.ai.providers.local.enabled) {
      throw new ApplicationError('local_ai_provider_disabled', 409, 'local AI provider is disabled.');
    }
    const request = this.requireRequest(input.requestId);
    this.assertRequestReferencesFinalized(request);
    const styleProfile = this.dependencies.repository.listStyleProfiles()[0];
    if (!styleProfile) throw new ApplicationError('style_profile_required', 409, 'A Style Profile is required.');
    const family: PlanFamily = {
      id: randomUUID(),
      requestId: request.id,
      provider: 'local',
      strategies: input.strategies,
      createdAt: new Date().toISOString(),
    };
    const knowledge = this.searchKnowledge(request.id);
    const plans: DesignPlan[] = [];
    for (const [candidateIndex, strategy] of input.strategies.entries()) {
      plans.push(await generateDesignPlan({
        provider: 'local',
        request,
        knowledge,
        styleProfile,
        config: this.dependencies.config,
        repository: this.dependencies.repository,
        variant: { familyId: family.id, strategy, candidateIndex },
      }));
    }
    if (new Set(plans.map((plan) => plan.fingerprint)).size !== plans.length) {
      throw new ApplicationError('duplicate_plan_candidate', 409, 'Candidate strategies produced duplicate plans.');
    }
    return this.dependencies.repository.savePlanFamily(family, plans);
  }

  public async createArtifacts(input: CreationRunInput): Promise<CreationRun> {
    const config = this.dependencies.config.design;
    if (!config.output.availableModes.includes(input.outputMode)) {
      throw new ApplicationError('output_mode_disabled', 409, 'The requested output mode is disabled.');
    }
    if ((input.outputMode === 'html' || input.outputMode === 'both') && !config.html.enabled) {
      throw new ApplicationError('html_adapter_disabled', 409, 'The HTML adapter is disabled.');
    }
    if ((input.outputMode === 'figma' || input.outputMode === 'both') && !config.figma.enabled) {
      throw new ApplicationError('figma_adapter_disabled', 409, 'The Figma adapter is disabled.');
    }
    if ((input.outputMode === 'figma' || input.outputMode === 'both')
      && config.figma.requireExistingFile && !input.figmaFileKey) {
      throw new ApplicationError('figma_file_required', 400, 'A target Figma file key is required.');
    }
    const plan = this.dependencies.repository.getPlan(input.planId);
    if (!plan) throw new ApplicationError('plan_not_found', 404, 'The Design Plan was not found.');
    return executeCreation(input, plan, {
      repository: this.dependencies.repository,
      artifactStore: this.dependencies.artifactStore,
      figmaConnected: Boolean(this.dependencies.config.figmaMcpServer),
    });
  }

  public recordFigmaDelivery(input: FigmaDeliveryInput): FigmaDelivery {
    const run = this.dependencies.repository.getRun(input.runId);
    if (!run) throw new ApplicationError('creation_run_not_found', 404, 'The Creation Run was not found.');
    if (run.outputMode !== 'figma' && run.outputMode !== 'both') {
      throw new ApplicationError('figma_delivery_not_expected', 409, 'The Creation Run does not include Figma output.');
    }
    if ((run.figmaFileKey && run.figmaFileKey !== input.fileKey)
      || (!run.figmaFileKey && this.dependencies.config.design.figma.requireExistingFile)) {
      throw new ApplicationError('figma_file_mismatch', 409, 'The delivery file does not match the Creation Run target.');
    }
    const expectedOperationKey = `figma:${run.id}:v1`;
    if (input.operationKey !== expectedOperationKey) {
      throw new ApplicationError(
        'figma_operation_mismatch',
        409,
        'The delivery operation key does not match the Creation Run operation.',
      );
    }
    const existing = this.dependencies.repository.getFigmaDelivery(input.runId, input.operationKey);
    if (existing) {
      const existingInput = { ...existing } as Partial<FigmaDelivery>;
      delete existingInput.id;
      delete existingInput.createdAt;
      if (JSON.stringify(existingInput) !== JSON.stringify(input)) {
        throw new ApplicationError('figma_operation_conflict', 409, 'The Figma operation key was reused with different evidence.');
      }
      return existing;
    }
    if (this.dependencies.repository.getCompletedFigmaDelivery(input.runId)) {
      throw new ApplicationError(
        'figma_delivery_already_completed',
        409,
        'The Creation Run already has a completed Figma delivery.',
      );
    }
    if (input.status === 'completed') {
      const evidenceIds = new Set([
        ...input.createdNodeIds,
        ...input.mutatedNodeIds,
        ...input.observedNodeIds,
      ]);
      if (!input.desktopNodeId || !input.mobileNodeId
        || !evidenceIds.has(input.desktopNodeId) || !evidenceIds.has(input.mobileNodeId)) {
        throw new ApplicationError(
          'figma_node_evidence_incomplete',
          409,
          'Completed delivery roots must be included in created or mutated node IDs.',
        );
      }
    }
    return this.dependencies.repository.createFigmaDelivery(input);
  }

  public recordEvaluation(input: EvaluationInput): Evaluation {
    return this.dependencies.repository.createEvaluation(input);
  }

  public compareArtifacts(input: ComparisonInput): { id: string; createdAt: string } & ComparisonInput {
    if (input.artifactAId === input.artifactBId) {
      throw new ApplicationError('comparison_requires_distinct_artifacts', 409, 'Comparison artifacts must be distinct.');
    }
    const artifactA = this.dependencies.repository.getArtifact(input.artifactAId);
    const artifactB = this.dependencies.repository.getArtifact(input.artifactBId);
    if (!artifactA || !artifactB) {
      throw new ApplicationError('comparison_artifact_not_found', 404, 'One or both comparison artifacts were not found.');
    }
    if (artifactA.kind !== 'html' || artifactB.kind !== 'html') {
      throw new ApplicationError('comparison_viewport_incompatible', 409, 'Only responsive HTML candidates are comparable.');
    }
    if (artifactA.sha256 === artifactB.sha256) {
      throw new ApplicationError('comparison_duplicate_artifact', 409, 'Duplicate artifacts cannot be comparison labels.');
    }
    const runA = this.dependencies.repository.getRun(artifactA.runId);
    const runB = this.dependencies.repository.getRun(artifactB.runId);
    const planA = runA ? this.dependencies.repository.getPlan(runA.planId) : null;
    const planB = runB ? this.dependencies.repository.getPlan(runB.planId) : null;
    if (!planA || !planB) {
      throw new ApplicationError('comparison_lineage_missing', 409, 'Comparison candidate lineage is incomplete.');
    }
    if (planA.requestId !== input.requestId || planB.requestId !== input.requestId || planA.familyId !== planB.familyId) {
      throw new ApplicationError('comparison_context_mismatch', 409, 'Candidates must belong to the same Request and Plan Family.');
    }
    if (planA.fingerprint === planB.fingerprint) {
      throw new ApplicationError('comparison_duplicate_plan', 409, 'Duplicate plans cannot be comparison labels.');
    }
    const contentSignature = (plan: DesignPlan) => plan.sections.map((section) => section.type).sort().join(':');
    if (contentSignature(planA) !== contentSignature(planB)) {
      throw new ApplicationError('comparison_content_incomplete', 409, 'Candidates must have equivalent content coverage.');
    }
    return this.dependencies.repository.createComparison(input);
  }

  public listComparisonContexts(): Array<Record<string, unknown>> {
    return this.dependencies.repository.listComparisons().map((comparison) => {
      const request = this.dependencies.repository.getRequest(comparison.requestId);
      const describe = (artifactId: string) => {
        const artifact = this.dependencies.repository.getArtifact(artifactId);
        const run = artifact ? this.dependencies.repository.getRun(artifact.runId) : null;
        const plan = run ? this.dependencies.repository.getPlan(run.planId) : null;
        return artifact && plan ? {
          artifactId,
          artifactSha256: artifact.sha256,
          planId: plan.id,
          familyId: plan.familyId,
          variantStrategy: plan.variantStrategy,
          provider: plan.generation.provider,
          model: plan.generation.model,
          knowledgeIds: plan.knowledgeIds,
          viewport: 'responsive-desktop-mobile',
          contentCompleteness: 'complete',
        } : null;
      };
      return { comparison, request, candidateA: describe(comparison.artifactAId), candidateB: describe(comparison.artifactBId) };
    });
  }

  public getRunStatus(runId: string): CreationRun {
    const run = this.dependencies.repository.getRun(runId);
    if (!run) throw new ApplicationError('run_not_found', 404, 'The Creation Run was not found.');
    return run;
  }

  public async readArtifact(artifactId: string): Promise<{
    artifact: NonNullable<ReturnType<Repository['getArtifact']>>;
    content: string;
  }> {
    const artifact = this.dependencies.repository.getArtifact(artifactId);
    if (!artifact) throw new ApplicationError('artifact_not_found', 404, 'The artifact was not found.');
    return { artifact, content: await this.dependencies.artifactStore.read(artifact.path) };
  }

  private requireRequest(requestId: string): DesignRequest {
    const request = this.dependencies.repository.getRequest(requestId);
    if (!request) throw new ApplicationError('request_not_found', 404, 'The Design Request was not found.');
    return request;
  }

  private assertRequestReferencesFinalized(request: DesignRequest): void {
    const unresolved = request.references.filter((reference) =>
      reference.status === 'pending' || reference.status === 'analyzed',
    );
    if (unresolved.length > 0) {
      throw new ApplicationError(
        'request_research_pending',
        409,
        'Finalize every request reference before planning.',
        { referenceIds: unresolved.map((reference) => reference.id) },
      );
    }
  }
}

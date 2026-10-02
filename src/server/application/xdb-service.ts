import { randomUUID } from 'node:crypto';

import type {
  AiProvider,
  ComparisonInput,
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
  KnowledgeItem,
  PlanFamily,
  PlanFamilyInput,
} from '../../shared/contracts.js';
import { generateDesignPlan } from '../ai/planning.js';
import type { ArtifactStore } from '../artifacts/store.js';
import type { RuntimeConfig } from '../config.js';
import type { Repository } from '../db/repository.js';
import { executeCreation } from '../domain/creation.js';
import { classifyDesignInput } from '../domain/intent.js';
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

  public classify(input: string): InputHookResult {
    return classifyDesignInput(input);
  }

  public searchKnowledge(requestId: string): KnowledgeItem[] {
    const request = this.requireRequest(requestId);
    return rankKnowledge(request, this.dependencies.repository.listKnowledge());
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
    if (!run.figmaFileKey || run.figmaFileKey !== input.fileKey) {
      throw new ApplicationError('figma_file_mismatch', 409, 'The delivery file does not match the Creation Run target.');
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
      const evidenceIds = new Set([...input.createdNodeIds, ...input.mutatedNodeIds]);
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
}

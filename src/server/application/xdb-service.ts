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
  InputHookResult,
  KnowledgeItem,
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
    const plan = this.dependencies.repository.getPlan(input.planId);
    if (!plan) throw new ApplicationError('plan_not_found', 404, 'The Design Plan was not found.');
    return executeCreation(input, plan, {
      repository: this.dependencies.repository,
      artifactStore: this.dependencies.artifactStore,
      figmaConnected: Boolean(this.dependencies.config.figmaMcpServer),
    });
  }

  public recordEvaluation(input: EvaluationInput): Evaluation {
    return this.dependencies.repository.createEvaluation(input);
  }

  public compareArtifacts(input: ComparisonInput): { id: string; createdAt: string } & ComparisonInput {
    return this.dependencies.repository.createComparison(input);
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

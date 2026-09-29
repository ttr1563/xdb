import { randomUUID } from 'node:crypto';

import type { CreationRun, CreationRunInput, DesignPlan } from '../../shared/contracts.js';
import { createFigmaExecutionScript, createFigmaOperationPlan } from '../adapters/figma.js';
import { renderStandaloneHtml } from '../adapters/html.js';
import type { ArtifactStore } from '../artifacts/store.js';
import type { Repository } from '../db/repository.js';

import { evaluatePlanStructure } from './evaluation.js';

interface CreationDependencies {
  repository: Repository;
  artifactStore: ArtifactStore;
  figmaConnected: boolean;
}

export async function executeCreation(
  input: CreationRunInput,
  plan: DesignPlan,
  dependencies: CreationDependencies,
): Promise<CreationRun> {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const wantsHtml = input.outputMode === 'html' || input.outputMode === 'both';
  const wantsFigma = input.outputMode === 'figma' || input.outputMode === 'both';
  const status: CreationRun['status'] = wantsFigma && !dependencies.figmaConnected
    ? wantsHtml
      ? 'partial'
      : 'blocked_external'
    : 'completed';
  const summary = status === 'completed'
    ? '要求された出力を生成しました。'
    : status === 'partial'
      ? 'HTMLを生成しました。Figmaは接続後にoperation planを実行できます。'
      : 'Figma接続が未設定です。operation planと実行scriptを生成しました。';

  dependencies.repository.saveCreationRun({ ...input, id, status, summary, createdAt });
  const artifacts = [];

  if (wantsHtml) {
    const artifact = await dependencies.artifactStore.write(id, 'html', renderStandaloneHtml(plan));
    artifacts.push(dependencies.repository.saveArtifact(artifact));
  }
  if (wantsFigma) {
    const operationPlan = createFigmaOperationPlan(plan, input.figmaFileKey);
    const planArtifact = await dependencies.artifactStore.write(
      id,
      'figma-plan',
      `${JSON.stringify(operationPlan, null, 2)}\n`,
    );
    artifacts.push(dependencies.repository.saveArtifact(planArtifact));
    const scriptArtifact = await dependencies.artifactStore.write(
      id,
      'figma-script',
      createFigmaExecutionScript(plan),
    );
    artifacts.push(dependencies.repository.saveArtifact(scriptArtifact));
  }
  if (plan.illustration) {
    const illustrationArtifact = await dependencies.artifactStore.write(
      id,
      'illustration-spec',
      `${JSON.stringify(plan.illustration, null, 2)}\n`,
    );
    artifacts.push(dependencies.repository.saveArtifact(illustrationArtifact));
  }

  const automaticReview = evaluatePlanStructure(plan);
  const reportArtifact = await dependencies.artifactStore.write(
    id,
    'report',
    `${JSON.stringify(automaticReview, null, 2)}\n`,
  );
  artifacts.push(dependencies.repository.saveArtifact(reportArtifact));
  for (const artifact of artifacts.filter((candidate) => candidate.kind === 'html' || candidate.kind === 'figma-plan')) {
    dependencies.repository.createEvaluation({
      artifactId: artifact.id,
      evaluatorType: 'automatic',
      scores: automaticReview.scores,
      rationale: automaticReview.limitations.join(' '),
      decision: automaticReview.checks.every((check) => check.passed) ? 'approved' : 'revise',
    });
  }

  dependencies.repository.setRequestStatus(plan.requestId, 'generated');
  return { ...input, id, status, summary, artifacts, createdAt };
}

import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { DesignRequest, StyleProfile } from '../../shared/contracts.js';
import { createDesignPlan } from '../domain/planner.js';

import { createFigmaExecutionScript, createFigmaOperationPlan } from './figma.js';
import { renderStandaloneHtml } from './html.js';

const request: DesignRequest = {
  id: randomUUID(),
  prompt: 'SaaS landing page design',
  projectName: 'XDB',
  audience: 'design teams',
  objective: 'start a project',
  concepts: ['clarity'],
  avoid: [],
  outputMode: 'both',
  intent: 'create-design',
  status: 'draft',
  createdAt: new Date().toISOString(),
};
const style: StyleProfile = {
  id: randomUUID(),
  name: 'Geometric',
  description: 'Precise geometric illustration system.',
  medium: 'vector',
  traits: ['precise', 'quiet', 'structured'],
  palette: ['#17211C', '#F5F4EF'],
  compositionRules: ['one focal point'],
  forbiddenTraits: ['clutter'],
  version: 1,
  createdAt: new Date().toISOString(),
};
const plan = createDesignPlan(request, [], style);

describe('creation adapters', () => {
  it('renders semantic standalone HTML with responsive and noindex safeguards', () => {
    const html = renderStandaloneHtml(plan);
    expect(html).toContain('<main>');
    expect(html).toContain('@media (max-width: 800px)');
    expect(html).toContain('noindex,nofollow');
    expect(html).toContain('aria-label');
    expect(html).toContain('class="strategy-baseline"');
  });

  it('creates a retryable Figma plan and script without claiming execution', () => {
    const operationPlan = createFigmaOperationPlan(plan, null);
    const script = createFigmaExecutionScript(plan);
    expect(operationPlan.target).toEqual({ fileKey: null, requiresExistingFile: true });
    expect(operationPlan.operations.some((operation) => operation.op === 'create-mobile-variant')).toBe(true);
    expect(script).toContain('return { success: true, createdNodeIds');
    expect(script).toContain('figma.createAutoLayout');
  });
});

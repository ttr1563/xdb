import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { knowledgeInputSchema } from '../../shared/contracts.js';

describe('research starter pack', () => {
  it('contains valid, retrievable samples that are excluded from training by default', () => {
    const content = readFileSync(
      path.join(process.cwd(), 'examples/research/design-systems-starter.jsonl'),
      'utf8',
    );
    const items = content.trim().split(/\r?\n/).map((line) => knowledgeInputSchema.parse(JSON.parse(line)));

    expect(items).toHaveLength(12);
    expect(new Set(items.map((item) => item.provenance.sourceUri)).size).toBe(items.length);
    expect(items.every((item) =>
      item.provenance.rightsStatus === 'unverified'
      && item.provenance.trainingEligible === false
      && item.provenance.sourceType === 'url'
    )).toBe(true);
  });
});

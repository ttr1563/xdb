import { describe, expect, it } from 'vitest';

import { classifyDesignInput } from './intent.js';

describe('classifyDesignInput', () => {
  it('routes illustration requests to the illustration workflow', () => {
    expect(classifyDesignInput('LPのHero用イラストを作ってください')).toMatchObject({
      intent: 'create-illustration',
      suggestedAction: 'illustrate',
    });
  });

  it('routes design evaluation requests to research', () => {
    expect(classifyDesignInput('このUIデザインを比較して評価して')).toMatchObject({
      intent: 'evaluate-design',
      suggestedAction: 'research',
    });
  });

  it('does not capture unrelated coding work', () => {
    expect(classifyDesignInput('データベースのmigrationを修正して')).toEqual({
      intent: 'non-design',
      confidence: 0.82,
      suggestedAction: 'ignore',
      signals: [],
    });
  });
});

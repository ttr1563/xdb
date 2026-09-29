import type { InputHookResult } from '../../shared/contracts.js';

const signals = {
  illustrate: ['イラスト', 'illustration', '画像生成', 'hero image', '挿絵'],
  create: ['デザイン', 'design', 'lp', 'landing page', '画面', 'ui', 'webサイト', 'website'],
  evaluate: ['評価', '採点', '比較', 'review', 'score', 'どちら'],
  research: ['研究', '事例', '傾向', '参考', 'research', 'pattern'],
} as const;

function matchingSignals(input: string, candidates: readonly string[]): string[] {
  const normalized = input.toLocaleLowerCase('ja');
  return candidates.filter((candidate) => normalized.includes(candidate));
}

export function classifyDesignInput(input: string): InputHookResult {
  const illustrationSignals = matchingSignals(input, signals.illustrate);
  const evaluationSignals = matchingSignals(input, signals.evaluate);
  const researchSignals = matchingSignals(input, signals.research);
  const creationSignals = matchingSignals(input, signals.create);

  if (illustrationSignals.length > 0) {
    return {
      intent: 'create-illustration',
      confidence: Math.min(0.98, 0.78 + illustrationSignals.length * 0.06),
      suggestedAction: 'illustrate',
      signals: illustrationSignals,
    };
  }
  if (evaluationSignals.length > 0 && creationSignals.length > 0) {
    return {
      intent: 'evaluate-design',
      confidence: 0.9,
      suggestedAction: 'research',
      signals: [...evaluationSignals, ...creationSignals],
    };
  }
  if (researchSignals.length > 0) {
    return {
      intent: 'research-design',
      confidence: Math.min(0.95, 0.76 + researchSignals.length * 0.05),
      suggestedAction: 'research',
      signals: researchSignals,
    };
  }
  if (creationSignals.length > 0) {
    return {
      intent: 'create-design',
      confidence: Math.min(0.96, 0.74 + creationSignals.length * 0.05),
      suggestedAction: 'plan',
      signals: creationSignals,
    };
  }
  return {
    intent: 'non-design',
    confidence: 0.82,
    suggestedAction: 'ignore',
    signals: [],
  };
}

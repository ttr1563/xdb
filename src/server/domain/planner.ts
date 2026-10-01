import { createHash, randomUUID } from 'node:crypto';

import type {
  DesignPlan,
  DesignRequest,
  DesignSection,
  DesignToken,
  KnowledgeItem,
  StyleProfile,
  VariantStrategy,
} from '../../shared/contracts.js';

interface PlanVariant {
  familyId?: string;
  strategy?: VariantStrategy;
  candidateIndex?: number;
}

const directionByStrategy: Record<VariantStrategy, DesignPlan['designDirection']> = {
  baseline: { primaryConcept: '', secondaryConcepts: [], density: 'medium', contrast: 'moderate', shape: 'balanced', motion: 'subtle' },
  conservative: { primaryConcept: '', secondaryConcepts: [], density: 'low', contrast: 'soft', shape: 'balanced', motion: 'none' },
  expressive: { primaryConcept: '', secondaryConcepts: [], density: 'medium', contrast: 'strong', shape: 'soft', motion: 'expressive' },
  'conversion-led': { primaryConcept: '', secondaryConcepts: [], density: 'high', contrast: 'strong', shape: 'precise', motion: 'subtle' },
};

export function designPlanFingerprint(plan: Omit<DesignPlan, 'fingerprint'>): string {
  return createHash('sha256').update(JSON.stringify({
    designDirection: plan.designDirection,
    sections: plan.sections,
    tokens: plan.tokens,
    illustration: plan.illustration,
  })).digest('hex');
}

function planSections(request: DesignRequest, strategy: VariantStrategy): DesignSection[] {
  const project = request.projectName;
  const strategyLabel = strategy === 'baseline' ? 'balanced' : strategy;
  return [
    {
      id: 'navigation',
      type: 'navigation',
      purpose: '主要導線とブランドの現在地を短時間で伝える',
      component: 'NavigationBar',
      variant: `${strategyLabel}-primary-action`,
      headline: project,
      body: '機能、価値、利用開始への短い導線',
    },
    {
      id: 'hero',
      type: 'hero',
      purpose: request.objective,
      component: 'SplitHero',
      variant: `${strategyLabel}-hero`,
      headline: `${project}で、迷わず次の一歩へ。`,
      body: `${request.audience}に向けて、複雑さを減らし価値を明確に伝えます。`,
    },
    {
      id: 'trust',
      type: 'trust',
      purpose: '主張の根拠を早い段階で示す',
      component: 'TrustStrip',
      variant: `${strategyLabel}-evidence`,
      headline: '選ばれる理由を、事実で。',
      body: '数値、利用者の声、運用上の安心材料を簡潔に提示します。',
    },
    {
      id: 'features',
      type: 'features',
      purpose: '機能ではなく利用者が得る変化を説明する',
      component: 'FeatureGrid',
      variant: `${strategyLabel}-outcomes`,
      headline: '必要なことに、集中できる設計。',
      body: '理解、実行、継続の三つの観点から価値を整理します。',
    },
    {
      id: 'workflow',
      type: 'workflow',
      purpose: '利用開始後の流れを予測可能にする',
      component: 'NumberedSteps',
      variant: 'three-step',
      headline: '始め方は、シンプルです。',
      body: '準備、実行、確認を三段階で示します。',
    },
    {
      id: 'cta',
      type: 'cta',
      purpose: request.objective,
      component: 'CallToActionPanel',
      variant: 'single-primary',
      headline: '次の一歩を、今日から。',
      body: '不安を解消する補足と、ひとつの主要アクションを配置します。',
    },
    {
      id: 'footer',
      type: 'footer',
      purpose: '問い合わせ、法務、補助導線を提供する',
      component: 'Footer',
      variant: 'compact',
      headline: project,
      body: '問い合わせ、利用条件、プライバシーへの導線',
    },
  ];
}

function planTokens(primaryConcept: string, strategy: VariantStrategy): DesignToken[] {
  const warm = ['親しみ', 'warm', 'approachable', 'friendly'].some((term) =>
    primaryConcept.toLocaleLowerCase('ja').includes(term),
  );
  return [
    { name: 'color.surface.canvas', type: 'color', value: '#F5F4EF', description: 'ページ全体の背景' },
    { name: 'color.surface.raised', type: 'color', value: '#FFFFFF', description: 'カードと前景面' },
    { name: 'color.text.primary', type: 'color', value: '#17211C', description: '主要テキスト' },
    { name: 'color.text.muted', type: 'color', value: '#5D6861', description: '補助テキスト' },
    { name: 'color.action.primary', type: 'color', value: strategy === 'expressive' ? '#7C3AED' : strategy === 'conversion-led' ? '#C2410C' : warm ? '#CA5A34' : '#16634A', description: '主要操作' },
    { name: 'color.accent.soft', type: 'color', value: strategy === 'expressive' ? '#DDD6FE' : strategy === 'conversion-led' ? '#FED7AA' : warm ? '#F2CDBF' : '#C8DDD4', description: '弱い強調面' },
    { name: 'space.sm', type: 'dimension', value: { value: 8, unit: 'px' }, description: '小さな間隔' },
    { name: 'space.md', type: 'dimension', value: { value: 16, unit: 'px' }, description: '標準間隔' },
    { name: 'space.lg', type: 'dimension', value: { value: 32, unit: 'px' }, description: 'section内の大きな間隔' },
    { name: 'space.xl', type: 'dimension', value: { value: 64, unit: 'px' }, description: 'section間隔' },
    { name: 'radius.control', type: 'dimension', value: { value: 10, unit: 'px' }, description: '操作要素の角丸' },
    { name: 'radius.panel', type: 'dimension', value: { value: 24, unit: 'px' }, description: '大きな面の角丸' },
    { name: 'font.family.body', type: 'fontFamily', value: 'Inter, system-ui, sans-serif', description: '本文書体' },
    { name: 'font.weight.strong', type: 'fontWeight', value: 700, description: '見出しの太さ' },
  ];
}

export function createDesignPlan(
  request: DesignRequest,
  knowledge: KnowledgeItem[],
  styleProfile: StyleProfile,
  variant: PlanVariant = {},
): DesignPlan {
  const id = randomUUID();
  const strategy = variant.strategy ?? 'baseline';
  const [primaryConcept, ...secondaryConcepts] = request.concepts;
  const concept = primaryConcept ?? '明快さ';
  const plan: Omit<DesignPlan, 'fingerprint'> = {
    id,
    requestId: request.id,
    familyId: variant.familyId ?? id,
    variantStrategy: strategy,
    candidateIndex: variant.candidateIndex ?? 0,
    version: 1,
    rationale: `${request.audience}が${request.objective}へ迷わず進めるよう、${concept}を主軸に${strategy}戦略で情報階層と視線誘導を設計します。過去ナレッジ${knowledge.length}件を参照し、主張・根拠・行動の順で構成します。`,
    designDirection: {
      ...directionByStrategy[strategy],
      primaryConcept: concept,
      secondaryConcepts,
    },
    sections: planSections(request, strategy),
    tokens: planTokens(concept, strategy),
    illustration: {
      purpose: 'hero',
      subject: `${request.audience}が${request.objective}を達成する場面`,
      styleProfileId: styleProfile.id,
      aspectRatio: '4:3',
      focalPoint: 'center',
      safeArea: 'left',
      required: ['明確な主題', '十分な余白', '小さい表示でも読めるシルエット'],
      avoid: [...request.avoid, ...styleProfile.forbiddenTraits].slice(0, 16),
    },
    knowledgeIds: knowledge.map((item) => item.id),
    generation: {
      provider: 'local',
      model: 'xdb-deterministic-v1',
      fallbackUsed: false,
    },
    createdAt: new Date().toISOString(),
  };
  return { ...plan, fingerprint: designPlanFingerprint(plan) };
}

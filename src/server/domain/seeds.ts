import type { KnowledgeInput, StyleProfileInput } from '../../shared/contracts.js';

const capturedAt = '2026-09-29T00:00:00.000Z';

export const knowledgeSeeds: KnowledgeInput[] = [
  {
    title: '主張・根拠・行動の順で視線を設計する',
    summary: '最初の画面で価値を伝え、その直後に根拠を置き、主要行動を一つに絞る。',
    kind: 'principle',
    contexts: ['landing-page', 'marketing-site', 'mobile', 'desktop'],
    concepts: ['明快さ', '信頼感', 'clarity', 'trustworthy'],
    evidence: '情報階層を評価するための初期仮説。人間の比較評価でcontext別に更新する。',
    provenance: { sourceType: 'system', sourceUri: null, license: null, rightsStatus: 'verified', trainingEligible: true, capturedAt },
  },
  {
    title: '主要CTAを競合させない',
    summary: '同じ視覚階層に複数の主要CTAを置かず、補助操作は明確に弱める。',
    kind: 'pattern',
    contexts: ['landing-page', 'signup', 'conversion'],
    concepts: ['明快さ', '集中', 'clarity'],
    evidence: '選択肢を減らす設計仮説。conversion実測とは区別して保持する。',
    provenance: { sourceType: 'system', sourceUri: null, license: null, rightsStatus: 'verified', trainingEligible: true, capturedAt },
  },
  {
    title: '無目的な装飾で情報密度を上げない',
    summary: '概念説明や視線誘導に寄与しない装飾は、認知負荷と画風のムラを増やす。',
    kind: 'anti-pattern',
    contexts: ['illustration', 'hero', 'marketing-site'],
    concepts: ['静けさ', '信頼感', 'calm', 'trustworthy'],
    evidence: '初期anti-pattern。承認・不採用画像の理由から具体化する。',
    provenance: { sourceType: 'system', sourceUri: null, license: null, rightsStatus: 'verified', trainingEligible: true, capturedAt },
  },
  {
    title: 'mobileで主題とCTAが同時に見える構図を優先する',
    summary: 'desktopの左右分割をそのまま縮小せず、mobileではコピー、CTA、主題の順に再配置する。',
    kind: 'pattern',
    contexts: ['responsive', 'mobile', 'hero'],
    concepts: ['使いやすさ', 'clarity', 'responsive'],
    evidence: 'responsive designの初期基準。viewport別screenshot評価で更新する。',
    provenance: { sourceType: 'system', sourceUri: null, license: null, rightsStatus: 'verified', trainingEligible: true, capturedAt },
  },
];

export const styleProfileSeeds: StyleProfileInput[] = [
  {
    name: 'Warm Editorial',
    description: '親しみと信頼を両立し、Webのコピーを邪魔しない編集的なフラットイラスト。',
    medium: 'flat vector illustration',
    traits: ['均一な輪郭線', '丸みのある形状', '中低彩度', '控えめな粒子感', '三層以内の奥行き'],
    palette: ['#17211C', '#F5F4EF', '#CA5A34', '#F2CDBF', '#8CAC9C'],
    compositionRules: ['人物は最大2名', '主題の反対側にコピー用余白を確保', '背景要素は最大3個'],
    forbiddenTraits: ['photorealism', 'glossy 3d', 'embedded text', 'heavy shadows', 'busy background'],
  },
  {
    name: 'Precise Geometric',
    description: '業務プロダクトに適した、正確で静かな幾何学表現。',
    medium: 'geometric vector illustration',
    traits: ['細部を抑えた幾何学', '一定のグリッド', '限定色', '明確なシルエット'],
    palette: ['#13231D', '#F6F7F3', '#16634A', '#C8DDD4'],
    compositionRules: ['主要オブジェクトを一つに限定', '8px gridへ整列', '余白を面積の30%以上確保'],
    forbiddenTraits: ['organic noise', 'random gradients', 'embedded text', 'decorative clutter'],
  },
];

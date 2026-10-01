import type { DesignPlan, DesignToken } from '../../shared/contracts.js';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function tokenValue(token: DesignToken): string {
  if (typeof token.value === 'object') {
    return `${token.value.value}${token.value.unit}`;
  }
  return String(token.value);
}

function cssName(name: string): string {
  return `--${name.replaceAll('.', '-')}`;
}

function renderIllustration(plan: DesignPlan): string {
  const label = escapeHtml(plan.illustration?.subject ?? 'Product experience');
  return `
    <svg class="hero-art" viewBox="0 0 640 520" role="img" aria-label="${label}">
      <rect width="640" height="520" rx="36" fill="var(--color-accent-soft)" />
      <circle cx="488" cy="118" r="68" fill="var(--color-action-primary)" opacity=".9" />
      <path d="M88 386C156 260 246 204 362 220c84 12 140 72 190 166H88Z" fill="#fff" opacity=".86" />
      <rect x="146" y="138" width="288" height="208" rx="24" fill="var(--color-surface-raised)" stroke="var(--color-text-primary)" stroke-width="6" />
      <rect x="178" y="178" width="132" height="18" rx="9" fill="var(--color-text-primary)" opacity=".9" />
      <rect x="178" y="218" width="216" height="12" rx="6" fill="var(--color-text-muted)" opacity=".4" />
      <rect x="178" y="248" width="176" height="12" rx="6" fill="var(--color-text-muted)" opacity=".28" />
      <rect x="178" y="294" width="112" height="30" rx="15" fill="var(--color-action-primary)" />
      <path d="M440 292c28-42 70-56 98-25 28 31 2 86-55 105-57-19-71-55-43-80Z" fill="var(--color-action-primary)" />
    </svg>
  `;
}

export function renderStandaloneHtml(plan: DesignPlan): string {
  const variables = plan.tokens.map((token) => `    ${cssName(token.name)}: ${tokenValue(token)};`).join('\n');
  const hero = plan.sections.find((section) => section.type === 'hero') ?? plan.sections[0];
  const features = plan.sections.find((section) => section.type === 'features');
  const workflow = plan.sections.find((section) => section.type === 'workflow');
  const cta = plan.sections.find((section) => section.type === 'cta');

  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  <title>${escapeHtml(hero?.headline ?? 'Design preview')}</title>
  <style>
  :root {
${variables}
    color-scheme: light;
  }
  * { box-sizing: border-box; }
  body { margin: 0; color: var(--color-text-primary); background: var(--color-surface-canvas); font-family: var(--font-family-body); line-height: 1.6; }
  a { color: inherit; }
  .shell { width: min(1160px, calc(100% - 40px)); margin-inline: auto; }
  .nav { min-height: 76px; display: flex; align-items: center; justify-content: space-between; gap: 24px; }
  .brand { font-weight: 800; letter-spacing: -.03em; }
  .nav-links { display: flex; align-items: center; gap: 28px; color: var(--color-text-muted); font-size: 14px; }
  .button { display: inline-flex; min-height: 48px; align-items: center; justify-content: center; padding: 0 24px; border-radius: var(--radius-control); background: var(--color-action-primary); color: white; text-decoration: none; font-weight: 750; box-shadow: 0 12px 30px rgb(23 33 28 / .12); }
  .button.secondary { background: transparent; color: var(--color-text-primary); box-shadow: inset 0 0 0 1px rgb(23 33 28 / .18); }
  .hero { display: grid; grid-template-columns: 1.02fr .98fr; gap: clamp(48px, 8vw, 104px); align-items: center; padding: 88px 0 104px; }
  .eyebrow { margin: 0 0 18px; color: var(--color-action-primary); font-size: 13px; font-weight: 800; letter-spacing: .13em; text-transform: uppercase; }
  h1 { max-width: 760px; margin: 0; font-size: clamp(48px, 6.2vw, 82px); line-height: .98; letter-spacing: -.055em; }
  .hero-copy { max-width: 620px; margin: 28px 0 0; color: var(--color-text-muted); font-size: clamp(17px, 2vw, 20px); }
  .actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 34px; }
  .hero-art { width: 100%; height: auto; filter: drop-shadow(0 24px 42px rgb(23 33 28 / .12)); }
  .trust { padding: 24px 0; border-block: 1px solid rgb(23 33 28 / .12); display: grid; grid-template-columns: 1.2fr repeat(3, 1fr); gap: 24px; align-items: center; }
  .trust strong { font-size: 14px; }
  .trust span { color: var(--color-text-muted); font-size: 13px; }
  .section { padding: 112px 0; }
  .section-heading { max-width: 660px; margin-bottom: 48px; }
  h2 { margin: 0 0 16px; font-size: clamp(36px, 4vw, 56px); line-height: 1.06; letter-spacing: -.045em; }
  .section-heading p { color: var(--color-text-muted); font-size: 18px; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
  .card { min-height: 280px; padding: 30px; border-radius: var(--radius-panel); background: var(--color-surface-raised); border: 1px solid rgb(23 33 28 / .09); }
  .card-index { width: 42px; height: 42px; display: grid; place-items: center; border-radius: 50%; background: var(--color-accent-soft); color: var(--color-text-primary); font-weight: 800; }
  .card h3 { margin: 56px 0 12px; font-size: 24px; letter-spacing: -.025em; }
  .card p { margin: 0; color: var(--color-text-muted); }
  .process { display: grid; grid-template-columns: .8fr 1.2fr; gap: 72px; align-items: start; }
  .steps { border-top: 1px solid rgb(23 33 28 / .15); }
  .step { display: grid; grid-template-columns: 56px 1fr; gap: 12px; padding: 26px 0; border-bottom: 1px solid rgb(23 33 28 / .15); }
  .step b { color: var(--color-action-primary); }
  .step p { margin: 4px 0 0; color: var(--color-text-muted); }
  .cta { margin-bottom: 48px; padding: clamp(38px, 7vw, 82px); border-radius: calc(var(--radius-panel) * 1.5); background: var(--color-text-primary); color: white; display: flex; justify-content: space-between; gap: 40px; align-items: end; }
  .cta h2 { max-width: 680px; }
  .cta p { margin: 0; color: rgb(255 255 255 / .68); }
  .footer { padding: 32px 0 52px; display: flex; justify-content: space-between; color: var(--color-text-muted); font-size: 13px; }
  .strategy-conservative .shell { width: min(1040px, calc(100% - 40px)); }
  .strategy-conservative h1 { font-size: clamp(44px, 5.4vw, 70px); }
  .strategy-conservative .button, .strategy-conservative .card { box-shadow: none; }
  .strategy-conservative .card { min-height: 250px; border-radius: 12px; }
  .strategy-expressive .hero { grid-template-columns: .88fr 1.12fr; }
  .strategy-expressive h1 { font-size: clamp(52px, 6.8vw, 90px); }
  .strategy-expressive .hero-art { transform: rotate(1.5deg); }
  .strategy-expressive .card:nth-child(2) { transform: translateY(28px); }
  .strategy-conversion-led .hero { grid-template-columns: 1.2fr .8fr; }
  .strategy-conversion-led .button { border-radius: 5px; }
  .strategy-conversion-led .trust { padding-inline: 24px; background: var(--color-surface-raised); border: 0; }
  .strategy-conversion-led .cta { border-radius: var(--radius-control); }
  @media (max-width: 800px) {
    .nav-links a:not(.button) { display: none; }
    .hero { grid-template-columns: 1fr; padding: 56px 0 72px; }
    .hero-art { max-width: 580px; }
    .trust { grid-template-columns: 1fr; }
    .grid { grid-template-columns: 1fr; }
    .card { min-height: 220px; }
    .process { grid-template-columns: 1fr; gap: 32px; }
    .cta { align-items: start; flex-direction: column; }
    .strategy-expressive .hero, .strategy-conversion-led .hero { grid-template-columns: 1fr; }
    .strategy-expressive .hero-art, .strategy-expressive .card:nth-child(2) { transform: none; }
  }
  @media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; } }
  </style>
</head>
<body class="strategy-${plan.variantStrategy}">
  <header class="shell nav" aria-label="メインナビゲーション">
    <div class="brand">${escapeHtml(plan.sections[0]?.headline ?? 'XDB')}</div>
    <nav class="nav-links"><a href="#features">価値</a><a href="#workflow">使い方</a><a class="button" href="#start">始める</a></nav>
  </header>
  <main>
    <section class="shell hero">
      <div><p class="eyebrow">Designed with evidence</p><h1>${escapeHtml(hero?.headline ?? '')}</h1><p class="hero-copy">${escapeHtml(hero?.body ?? '')}</p><div class="actions"><a class="button" href="#start">無料で始める</a><a class="button secondary" href="#features">詳しく見る</a></div></div>
      <div>${renderIllustration(plan)}</div>
    </section>
    <section class="shell trust" aria-label="信頼の根拠"><strong>判断できる根拠を、先に。</strong><span>明快な料金と条件</span><span>安心できる運用設計</span><span>迷わないサポート</span></section>
    <section class="shell section" id="features"><div class="section-heading"><p class="eyebrow">Why it works</p><h2>${escapeHtml(features?.headline ?? '')}</h2><p>${escapeHtml(features?.body ?? '')}</p></div><div class="grid"><article class="card"><div class="card-index">01</div><h3>理解できる</h3><p>必要な情報だけを、判断しやすい順番で提示します。</p></article><article class="card"><div class="card-index">02</div><h3>すぐ動ける</h3><p>主な操作を一つに絞り、次の行動を明確にします。</p></article><article class="card"><div class="card-index">03</div><h3>続けられる</h3><p>運用や変更まで見通せる、一貫した仕組みにします。</p></article></div></section>
    <section class="shell section process" id="workflow"><div><p class="eyebrow">Simple process</p><h2>${escapeHtml(workflow?.headline ?? '')}</h2><p>${escapeHtml(workflow?.body ?? '')}</p></div><div class="steps"><div class="step"><b>01</b><div><strong>要望を整理</strong><p>目的、対象、制約を短いbriefにまとめます。</p></div></div><div class="step"><b>02</b><div><strong>根拠から設計</strong><p>過去の評価とコンセプトから方向性を選びます。</p></div></div><div class="step"><b>03</b><div><strong>比較して改善</strong><p>候補を見比べ、選択理由を次へつなげます。</p></div></div></div></section>
    <section class="shell cta" id="start"><div><p class="eyebrow">Start with clarity</p><h2>${escapeHtml(cta?.headline ?? '')}</h2><p>${escapeHtml(cta?.body ?? '')}</p></div><a class="button" href="#">始める</a></section>
  </main>
  <footer class="shell footer"><span>Generated from a versioned Design Plan.</span><span>Preview · noindex</span></footer>
</body>
</html>`;
}

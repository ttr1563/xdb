import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

import type {
  AiProvider,
  AiRun,
  CreationRun,
  DashboardSummary,
  DesignConfig,
  DesignPlan,
  DesignRequest,
  Evaluation,
  KnowledgeItem,
  OutputMode,
  ScoreSet,
  StyleProfile,
} from '../shared/contracts';

import { api } from './api';

type View = 'overview' | 'create' | 'research' | 'illustration' | 'review';

interface PublicConfig {
  design: DesignConfig;
  capabilities: {
    figmaConnected: boolean;
    imageProviderConnected: boolean;
    anthropicConnected: boolean;
    anthropicLiveEnabled: boolean;
    anthropicBlockReason: string | null;
    anthropicMonthlyTokensUsed: number;
    anthropicMonthlyTokenBudget: number;
  };
}

interface AppData {
  config: PublicConfig;
  summary: DashboardSummary;
  knowledge: KnowledgeItem[];
  requests: DesignRequest[];
  plans: DesignPlan[];
  runs: CreationRun[];
  evaluations: Evaluation[];
  styles: StyleProfile[];
  aiRuns: AiRun[];
}

const emptySummary: DashboardSummary = {
  requests: 0,
  knowledgeItems: 0,
  plans: 0,
  creationRuns: 0,
  evaluations: 0,
  approvedArtifacts: 0,
};

const scoreLabels: Record<keyof ScoreSet, string> = {
  hierarchy: '情報階層',
  clarity: '明快さ',
  composition: '構成',
  typography: '文字',
  color: '色',
  spacing: '余白',
  conceptFit: 'コンセプト',
  distinctiveness: '独自性',
  accessibility: 'アクセシビリティ',
  implementability: '実装性',
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`status status--${status}`}>{status.replaceAll('_', ' ')}</span>;
}

function EmptyState({ children }: { children: string }) {
  return <div className="empty-state"><span>∅</span><p>{children}</p></div>;
}

function Overview({ data, onNavigate }: { data: AppData; onNavigate: (view: View) => void }) {
  const latestRun = data.runs[0];
  return (
    <div className="view-stack">
      <section className="intro-panel">
        <div>
          <p className="kicker">DESIGN INTELLIGENCE / 01</p>
          <h1>感覚を、<br /><em>再現できる知識</em>へ。</h1>
          <p className="lead">人の評価を根拠として蓄積し、設計し、FigmaとHTMLへ変換するデザイン研究環境です。</p>
          <div className="button-row">
            <button className="primary-button" onClick={() => onNavigate('create')}>新しいデザインを始める <span>↗</span></button>
            <button className="text-button" onClick={() => onNavigate('research')}>ナレッジを見る</button>
          </div>
        </div>
        <div className="signal-orbit" aria-label="Research, plan, create, evaluate cycle">
          <div className="orbit-ring orbit-ring--outer" />
          <div className="orbit-ring orbit-ring--inner" />
          <div className="orbit-core"><b>{data.summary.knowledgeItems}</b><span>signals</span></div>
          <span className="orbit-label orbit-label--one">Research</span>
          <span className="orbit-label orbit-label--two">Plan</span>
          <span className="orbit-label orbit-label--three">Create</span>
          <span className="orbit-label orbit-label--four">Evaluate</span>
        </div>
      </section>

      <section className="metric-grid" aria-label="プロジェクト集計">
        {[
          ['Knowledge', data.summary.knowledgeItems, '評価可能な知識'],
          ['Plans', data.summary.plans, '根拠付き設計'],
          ['Runs', data.summary.creationRuns, '生成履歴'],
          ['Human approved', data.summary.approvedArtifacts, '人が承認した成果物'],
        ].map(([label, value, caption]) => (
          <article className="metric-card" key={String(label)}><span>{label}</span><strong>{value}</strong><small>{caption}</small></article>
        ))}
      </section>

      <section className="split-grid">
        <article className="panel">
          <div className="panel-heading"><div><p className="kicker">RECENT RUN</p><h2>直近の生成</h2></div><button className="icon-button" onClick={() => onNavigate('review')} aria-label="レビューへ">↗</button></div>
          {latestRun ? (
            <div className="run-summary">
              <div className="run-meta"><StatusBadge status={latestRun.status} /><span>{formatDate(latestRun.createdAt)}</span></div>
              <p>{latestRun.summary}</p>
              <div className="artifact-links">
                {latestRun.artifacts.map((artifact) => <a href={`/artifacts/${artifact.path}`} target="_blank" rel="noreferrer" key={artifact.id}>{artifact.kind} ↗</a>)}
              </div>
            </div>
          ) : <EmptyState>まだ生成履歴がありません。</EmptyState>}
        </article>
        <article className="panel panel--dark">
          <p className="kicker kicker--light">KNOWLEDGE PULSE</p>
          <h2>良さを平均化せず、<br />文脈ごとに学ぶ。</h2>
          <p>業種、対象、目的、コンセプトを保持したまま、人の比較判断を次の設計へ返します。</p>
          <div className="pulse-row"><span>Human evaluations</span><b>{data.evaluations.filter((item) => item.evaluatorType === 'human').length}</b></div>
          <div className="pulse-row"><span>Style profiles</span><b>{data.styles.length}</b></div>
        </article>
      </section>
    </div>
  );
}

function CreateStudio({ data, refresh }: { data: AppData; refresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [mode, setMode] = useState<OutputMode>('both');
  const [provider, setProvider] = useState<AiProvider>(data.config.design.ai.defaultProvider);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    try {
      const request = await api<DesignRequest>('/api/requests', {
        method: 'POST',
        body: JSON.stringify({
          prompt: String(form.get('prompt')),
          projectName: String(form.get('projectName')),
          audience: String(form.get('audience')),
          objective: String(form.get('objective')),
          concepts: String(form.get('concepts')).split(',').map((value) => value.trim()).filter(Boolean),
          avoid: String(form.get('avoid')).split(',').map((value) => value.trim()).filter(Boolean),
          outputMode: mode,
        }),
      });
      const plan = await api<DesignPlan>('/api/plans', {
        method: 'POST',
        body: JSON.stringify({ requestId: request.id, provider }),
      });
      const run = await api<CreationRun>('/api/runs', {
        method: 'POST',
        body: JSON.stringify({ planId: plan.id, outputMode: mode, figmaFileKey: null }),
      });
      setMessage(run.summary);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '生成に失敗しました。');
    } finally {
      setBusy(false);
    }
  }

  const latestPlan = data.plans[0];
  const anthropicStatus = data.config.capabilities.anthropicLiveEnabled
    ? 'Claude外部実行が有効です。利用量と実行結果は履歴へ記録されます。'
    : `Claude外部実行は停止中です（${data.config.capabilities.anthropicBlockReason ?? 'provider_disabled'}）。選択時は設定に従ってLocalへfallbackします。`;
  return (
    <div className="view-stack">
      <header className="page-heading"><div><p className="kicker">CREATE / 02</p><h1>デザインを計画し、<br />形にする。</h1></div><p>要望を構造化し、関連ナレッジを根拠としてDesign Planを生成します。</p></header>
      <section className="studio-grid">
        <form className="panel form-panel" onSubmit={(event) => void submit(event)}>
          <div className="field-row"><label>プロジェクト名<input name="projectName" defaultValue="Invoice Flow" required minLength={2} /></label><label>出力先<div className="segmented">{(['figma', 'html', 'both'] as const).map((value) => <button type="button" className={mode === value ? 'active' : ''} onClick={() => setMode(value)} key={value}>{value}</button>)}</div></label></div>
          <label>Planning AI<div className="segmented">{(['local', 'anthropic'] as const).filter((value) => data.config.design.ai.providers[value].enabled).map((value) => <button type="button" className={provider === value ? 'active' : ''} onClick={() => setProvider(value)} key={value}>{value === 'anthropic' ? 'Claude' : 'Local'}</button>)}</div><small>{anthropicStatus}</small></label>
          <label>要望<textarea name="prompt" defaultValue="個人事業主向け請求書サービスのLPをデザインして。信頼感は必要だが堅すぎず、Heroには一貫したイラストを使いたい。" required minLength={12} rows={5} /></label>
          <div className="field-row"><label>対象ユーザー<input name="audience" defaultValue="ITに詳しくない個人事業主" required /></label><label>主要目的<input name="objective" defaultValue="無料登録への誘導" required /></label></div>
          <div className="field-row"><label>コンセプト <small>カンマ区切り</small><input name="concepts" defaultValue="信頼感, 親しみ, 簡単さ" required /></label><label>避ける表現 <small>カンマ区切り</small><input name="avoid" defaultValue="派手なグラデーション, 過度な3D, 情報過多" /></label></div>
          <div className="form-actions"><button className="primary-button" disabled={busy}>{busy ? 'Research → Plan → Create…' : '一連の生成を実行'} <span>↗</span></button>{message && <p className="form-message" role="status">{message}</p>}</div>
        </form>
        <aside className="panel context-panel">
          <p className="kicker">CURRENT CONTEXT</p><h2>生成前に使われる知識</h2>
          <div className="context-stat"><strong>{data.knowledge.length}</strong><span>knowledge items</span></div>
          <div className="context-stat"><strong>{data.styles.length}</strong><span>illustration styles</span></div>
          <ul>{data.knowledge.slice(0, 3).map((item) => <li key={item.id}><span>{item.kind}</span>{item.title}</li>)}</ul>
        </aside>
      </section>
      {latestPlan && <section className="panel plan-preview"><div className="panel-heading"><div><p className="kicker">LATEST PLAN · {latestPlan.generation.provider}{latestPlan.generation.fallbackUsed ? ' · FALLBACK' : ''}</p><h2>{latestPlan.designDirection.primaryConcept}</h2></div><span className="plan-version">v{latestPlan.version}</span></div><p>{latestPlan.rationale}</p><div className="section-flow">{latestPlan.sections.map((section, index) => <div key={section.id}><span>{String(index + 1).padStart(2, '0')}</span><b>{section.type}</b><small>{section.component}</small></div>)}</div></section>}
      <section className="panel ai-audit">
        <div className="panel-heading"><div><p className="kicker">AI RUN AUDIT</p><h2>Planning実行履歴</h2></div><span>{data.config.capabilities.anthropicMonthlyTokensUsed} / {data.config.capabilities.anthropicMonthlyTokenBudget} monthly tokens</span></div>
        {data.aiRuns.length === 0 ? <EmptyState>まだPlanning実行履歴がありません。</EmptyState> : <div className="ai-run-list">{data.aiRuns.slice(0, 6).map((run) => <article key={run.id}><div><StatusBadge status={run.status} /><b>{run.provider}{run.model ? ` · ${run.model}` : ''}</b><time>{formatDate(run.createdAt)}</time></div><p>{run.inputTokens === null && run.outputTokens === null ? 'tokens not reported' : `${(run.inputTokens ?? 0) + (run.outputTokens ?? 0)} tokens`} · {run.latencyMs} ms · {run.attemptCount} attempts</p>{run.errorCode && <small>{run.errorCode}: {run.error}</small>}</article>)}</div>}
      </section>
    </div>
  );
}

function ResearchStudio({ data, refresh }: { data: AppData; refresh: () => Promise<void> }) {
  const [message, setMessage] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api('/api/knowledge', {
        method: 'POST',
        body: JSON.stringify({
          title: String(form.get('title')),
          summary: String(form.get('summary')),
          kind: form.get('kind'),
          contexts: String(form.get('contexts')).split(',').map((value) => value.trim()).filter(Boolean),
          concepts: String(form.get('concepts')).split(',').map((value) => value.trim()).filter(Boolean),
          evidence: String(form.get('evidence')),
          provenance: { sourceType: 'human', sourceUri: null, license: null, trainingEligible: false, capturedAt: new Date().toISOString() },
        }),
      });
      event.currentTarget.reset();
      setMessage('ナレッジを登録しました。出典・権利確認までは学習対象外です。');
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '登録に失敗しました。');
    }
  }
  return (
    <div className="view-stack"><header className="page-heading"><div><p className="kicker">RESEARCH / 03</p><h1>良い理由と、<br />使える文脈を残す。</h1></div><p>参考画像だけでなく、要件・評価理由・出典を一つの知識として記録します。</p></header>
      <section className="research-layout"><div className="knowledge-list">{data.knowledge.map((item) => <article className="knowledge-card" key={item.id}><div><StatusBadge status={item.kind} /><time>{formatDate(item.createdAt)}</time></div><h2>{item.title}</h2><p>{item.summary}</p><div className="tag-row">{[...item.contexts, ...item.concepts].slice(0, 6).map((tag) => <span key={tag}>{tag}</span>)}</div><footer><span>根拠</span>{item.evidence}</footer></article>)}</div>
      <form className="panel compact-form" onSubmit={(event) => void submit(event)}><p className="kicker">ADD SIGNAL</p><h2>ナレッジを登録</h2><label>タイトル<input name="title" required minLength={2} /></label><label>要約<textarea name="summary" required minLength={8} rows={3} /></label><label>種別<select name="kind"><option value="pattern">pattern</option><option value="principle">principle</option><option value="reference">reference</option><option value="anti-pattern">anti-pattern</option></select></label><label>文脈<input name="contexts" placeholder="landing-page, finance" required /></label><label>コンセプト<input name="concepts" placeholder="信頼感, clarity" required /></label><label>根拠<textarea name="evidence" required minLength={4} rows={3} /></label><button className="primary-button">登録する</button>{message && <p className="form-message">{message}</p>}</form></section>
    </div>
  );
}

function IllustrationStudio({ data }: { data: AppData }) {
  return <div className="view-stack"><header className="page-heading"><div><p className="kicker">ILLUSTRATION / 04</p><h1>画風を仕様にして、<br />ムラを減らす。</h1></div><p>承認済み・不採用事例をStyle Profileに結び、生成条件と判断理由を追跡します。</p></header><section className="style-grid">{data.styles.map((style) => <article className="style-card" key={style.id}><div className="palette">{style.palette.map((color) => <span style={{ background: color }} title={color} key={color} />)}</div><p className="kicker">STYLE PROFILE · V{style.version}</p><h2>{style.name}</h2><p>{style.description}</p><dl><div><dt>Medium</dt><dd>{style.medium}</dd></div><div><dt>Traits</dt><dd>{style.traits.join(' · ')}</dd></div><div><dt>Avoid</dt><dd>{style.forbiddenTraits.join(' · ')}</dd></div></dl></article>)}</section></div>;
}

function ReviewStudio({ data, refresh }: { data: AppData; refresh: () => Promise<void> }) {
  const htmlArtifacts = data.runs.flatMap((run) => run.artifacts).filter((artifact) => artifact.kind === 'html');
  const [rationale, setRationale] = useState('要件への適合度と情報階層がより明確だったため。');
  const [message, setMessage] = useState<string | null>(null);
  const pair = htmlArtifacts.slice(0, 2);
  async function prefer(artifactId: string): Promise<void> {
    if (pair.length < 2 || !data.requests[0]) return;
    try {
      await api('/api/comparisons', { method: 'POST', body: JSON.stringify({ requestId: data.requests[0].id, artifactAId: pair[0]?.id, artifactBId: pair[1]?.id, preferredArtifactId: artifactId, rationale }) });
      setMessage('比較判断を保存しました。');
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : '保存に失敗しました。'); }
  }
  return <div className="view-stack"><header className="page-heading"><div><p className="kicker">EVALUATE / 05</p><h1>スコアより先に、<br />選んだ理由を残す。</h1></div><p>絶対評価と比較評価を分け、コンセプトごとの選択傾向を蓄積します。</p></header>
    {pair.length >= 2 ? <><section className="compare-grid">{pair.map((artifact, index) => <article className="compare-card" key={artifact.id}><header><span>Candidate {String.fromCharCode(65 + index)}</span><button onClick={() => void prefer(artifact.id)}>こちらを選ぶ</button></header><iframe src={`/artifacts/${artifact.path}`} title={`Candidate ${String.fromCharCode(65 + index)}`} /></article>)}</section><section className="panel review-reason"><label>選択理由<textarea value={rationale} onChange={(event) => setRationale(event.target.value)} rows={3} /></label>{message && <p className="form-message">{message}</p>}</section></> : <EmptyState>比較にはHTML生成物が2件必要です。Createから別の候補を生成してください。</EmptyState>}
    <section className="evaluation-list"><div className="panel-heading"><div><p className="kicker">SCORE HISTORY</p><h2>評価履歴</h2></div><span>{data.evaluations.length} reviews</span></div>{data.evaluations.length === 0 ? <EmptyState>まだ評価がありません。</EmptyState> : data.evaluations.slice(0, 6).map((evaluation) => <article key={evaluation.id}><div><StatusBadge status={evaluation.decision} /><span>{evaluation.evaluatorType}</span><time>{formatDate(evaluation.createdAt)}</time></div><p>{evaluation.rationale}</p><div className="score-strip">{Object.entries(evaluation.scores).map(([key, value]) => <span key={key}><small>{scoreLabels[key as keyof ScoreSet]}</small><b>{value.toFixed(1)}</b></span>)}</div></article>)}</section>
  </div>;
}

export function App() {
  const [view, setView] = useState<View>('overview');
  const [data, setData] = useState<AppData>({
    config: {
      design: {
        version: 1,
        output: { defaultMode: 'both', availableModes: ['figma', 'html', 'both'] },
        ai: { defaultProvider: 'local', providers: { local: { enabled: true }, anthropic: { enabled: false, allowExternalRequests: false, fallbackToLocal: true, allowedBaseUrls: ['https://api.anthropic.com'], timeoutMs: 30_000, maxOutputTokens: 4_096, maxRetries: 1, retryBaseDelayMs: 500, monthlyTokenBudget: 0 } } },
        figma: { enabled: true, requireExistingFile: true, reuseExistingComponents: true, reuseExistingVariables: true },
        html: { enabled: true, format: 'standalone', responsive: true, accessibilityTarget: 'WCAG-AA' },
        illustration: { enabled: true, candidateCount: 4, requireHumanApproval: true, storeRejectedCandidates: true },
        evaluation: { automatic: true, pairwiseComparison: true, requireHumanReview: true },
        knowledge: { recordProvenance: true, recordRejectedDesigns: true },
      },
      capabilities: { figmaConnected: false, imageProviderConnected: false, anthropicConnected: false, anthropicLiveEnabled: false, anthropicBlockReason: 'external_requests_disabled', anthropicMonthlyTokensUsed: 0, anthropicMonthlyTokenBudget: 0 },
    },
    summary: emptySummary,
    knowledge: [],
    requests: [],
    plans: [],
    runs: [],
    evaluations: [],
    styles: [],
    aiRuns: [],
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [config, summary, knowledge, requests, plans, runs, evaluations, styles, aiRuns] = await Promise.all([
        api<PublicConfig>('/api/config'), api<DashboardSummary>('/api/dashboard'), api<KnowledgeItem[]>('/api/knowledge'), api<DesignRequest[]>('/api/requests'), api<DesignPlan[]>('/api/plans'), api<CreationRun[]>('/api/runs'), api<Evaluation[]>('/api/evaluations'), api<StyleProfile[]>('/api/style-profiles'), api<AiRun[]>('/api/ai-runs'),
      ]);
      setData({ config, summary, knowledge, requests, plans, runs, evaluations, styles, aiRuns });
      setError(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'データを取得できません。'); } finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const content = useMemo(() => {
    if (loading) return <div className="loading"><span />Loading design intelligence…</div>;
    if (error) return <div className="error-panel"><h1>接続できません</h1><p>{error}</p><button onClick={() => void refresh()}>再試行</button></div>;
    if (view === 'create') return <CreateStudio data={data} refresh={refresh} />;
    if (view === 'research') return <ResearchStudio data={data} refresh={refresh} />;
    if (view === 'illustration') return <IllustrationStudio data={data} />;
    if (view === 'review') return <ReviewStudio data={data} refresh={refresh} />;
    return <Overview data={data} onNavigate={setView} />;
  }, [data, error, loading, refresh, view]);

  const navigation: Array<{ id: View; label: string; number: string }> = [
    { id: 'overview', label: 'Overview', number: '01' }, { id: 'create', label: 'Create', number: '02' }, { id: 'research', label: 'Research', number: '03' }, { id: 'illustration', label: 'Illustration', number: '04' }, { id: 'review', label: 'Evaluate', number: '05' },
  ];
  return <div className="app-shell"><aside className="sidebar"><button className="logo" onClick={() => setView('overview')} aria-label="XDB overview"><span>X</span>DB</button><nav>{navigation.map((item) => <button className={view === item.id ? 'active' : ''} onClick={() => setView(item.id)} key={item.id}><span>{item.number}</span>{item.label}</button>)}</nav><div className="sidebar-footer"><span className="live-dot" />Local knowledge<br /><small>Private by default</small></div></aside><main className="content">{content}</main></div>;
}

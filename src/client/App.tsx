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
  FigmaDelivery,
  KnowledgeItem,
  KnowledgeImportBatch,
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
  figmaDeliveries: FigmaDelivery[];
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
  const latestFigmaDelivery = latestRun
    ? data.figmaDeliveries.find((delivery) => delivery.runId === latestRun.id && delivery.status === 'completed')
    : undefined;
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
                {latestFigmaDelivery && <a href={`https://www.figma.com/design/${latestFigmaDelivery.fileKey}`} target="_blank" rel="noreferrer">Figma design ↗</a>}
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
    const figmaFileKey = mode === 'figma' || mode === 'both'
      ? String(form.get('figmaFileKey') ?? '').trim() || null
      : null;
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
      if (provider === 'local') {
        const result = await api<{ plans: DesignPlan[] }>('/api/plan-families', {
          method: 'POST',
          body: JSON.stringify({ requestId: request.id }),
        });
        for (const plan of result.plans) {
          await api<CreationRun>('/api/runs', {
            method: 'POST',
            body: JSON.stringify({ planId: plan.id, outputMode: mode, figmaFileKey }),
          });
        }
        setMessage(`${result.plans.length}件の比較候補を生成しました。Evaluateで比較できます。`);
      } else {
        const plan = await api<DesignPlan>('/api/plans', {
          method: 'POST',
          body: JSON.stringify({ requestId: request.id, provider }),
        });
        const run = await api<CreationRun>('/api/runs', {
          method: 'POST',
          body: JSON.stringify({ planId: plan.id, outputMode: mode, figmaFileKey }),
        });
        setMessage(run.summary);
      }
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
          {(mode === 'figma' || mode === 'both') && <label>Figma file key <small>Figma Design URLの`/design/`直後の値。外部writeは生成後に明示実行します。</small><input name="figmaFileKey" placeholder="RkB6IUKpm4oXF4zUkSYveg" required={data.config.design.figma.requireExistingFile} /></label>}
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
      {latestPlan && <section className="panel plan-preview"><div className="panel-heading"><div><p className="kicker">LATEST PLAN · {latestPlan.generation.provider} · {latestPlan.variantStrategy}{latestPlan.generation.fallbackUsed ? ' · FALLBACK' : ''}</p><h2>{latestPlan.designDirection.primaryConcept}</h2></div><span className="plan-version">#{latestPlan.candidateIndex + 1} · v{latestPlan.version}</span></div><p>{latestPlan.rationale}</p><div className="section-flow">{latestPlan.sections.map((section, index) => <div key={section.id}><span>{String(index + 1).padStart(2, '0')}</span><b>{section.type}</b><small>{section.component}</small></div>)}</div></section>}
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
      const sourceUri = String(form.get('sourceUri') ?? '').trim() || null;
      const license = String(form.get('license') ?? '').trim() || null;
      const knowledge = await api<KnowledgeItem>('/api/knowledge', {
        method: 'POST',
        body: JSON.stringify({
          title: String(form.get('title')),
          summary: String(form.get('summary')),
          kind: form.get('kind'),
          contexts: String(form.get('contexts')).split(',').map((value) => value.trim()).filter(Boolean),
          concepts: String(form.get('concepts')).split(',').map((value) => value.trim()).filter(Boolean),
          evidence: String(form.get('evidence')),
          provenance: {
            sourceType: form.get('sourceType'),
            sourceUri,
            license,
            rightsStatus: form.get('rightsStatus'),
            trainingEligible: form.get('trainingEligible') === 'on',
            capturedAt: new Date().toISOString(),
          },
        }),
      });
      const asset = form.get('asset');
      if (asset instanceof File && asset.size > 0) {
        const body = new FormData();
        body.append('file', asset);
        try {
          await api(`/api/knowledge/${knowledge.id}/asset`, { method: 'POST', body });
        } catch (error) {
          setMessage(`ナレッジは登録済みですが、参照画像は保存できませんでした: ${error instanceof Error ? error.message : 'unknown error'}`);
          await refresh();
          return;
        }
      }
      event.currentTarget.reset();
      setMessage('ナレッジを登録しました。出典・権利確認までは学習対象外です。');
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '登録に失敗しました。');
    }
  }
  async function importMetadata(file: File): Promise<void> {
    try {
      const content = await file.text();
      const parsedJson = file.name.toLocaleLowerCase().endsWith('.jsonl') ? null : JSON.parse(content) as unknown;
      const jsonItems = parsedJson && typeof parsedJson === 'object' && 'items' in parsedJson
        ? (parsedJson as { items: unknown }).items
        : parsedJson;
      const batch = file.name.toLocaleLowerCase().endsWith('.jsonl')
        ? await api<KnowledgeImportBatch>('/api/knowledge/import', {
          method: 'POST', body: content, headers: { 'Content-Type': 'application/x-ndjson' },
        })
        : await api<KnowledgeImportBatch>('/api/knowledge/import', {
          method: 'POST', body: JSON.stringify({ format: 'json', items: jsonItems }),
        });
      setMessage(`Import ${batch.status}: ${batch.createdCount}件作成、${batch.duplicateCount}件重複、${batch.rejectedCount}件拒否。`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Importに失敗しました。');
    }
  }
  async function changeLifecycle(item: KnowledgeItem, action: 'exclude' | 'restore' | 'delete'): Promise<void> {
    if (action === 'delete' && !window.confirm('本文と出典を消去し、復元不能なtombstoneへ変更しますか？')) return;
    try {
      await api(`/api/knowledge/${item.id}/lifecycle`, {
        method: 'PATCH',
        body: JSON.stringify({ action, reason: action === 'delete' ? 'User requested deletion.' : `User requested ${action}.` }),
      });
      setMessage(`${item.title}を${action}へ変更しました。`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '状態変更に失敗しました。');
    }
  }
  return (
    <div className="view-stack"><header className="page-heading"><div><p className="kicker">RESEARCH / 03</p><h1>良い理由と、<br />使える文脈を残す。</h1></div><p>参考画像だけでなく、要件・評価理由・出典を一つの知識として記録します。</p></header>
      <section className="research-layout"><div className="knowledge-list">{data.knowledge.map((item) => <article className={`knowledge-card knowledge-card--${item.lifecycle}`} key={item.id}><div><span><StatusBadge status={item.kind} /> <StatusBadge status={item.lifecycle} /></span><time>{formatDate(item.createdAt)}</time></div><h2>{item.title}</h2><p>{item.summary}</p><div className="tag-row">{[...item.contexts, ...item.concepts].slice(0, 6).map((tag) => <span key={tag}>{tag}</span>)}</div><footer><span>根拠 · rights {item.provenance.rightsStatus}</span>{item.evidence}{item.duplicateOfId && <small>Duplicate: {item.duplicateKind} → {item.duplicateOfId}</small>}<div className="knowledge-actions">{item.lifecycle === 'active' && <button onClick={() => void changeLifecycle(item, 'exclude')}>Exclude</button>}{item.lifecycle === 'excluded' && <button onClick={() => void changeLifecycle(item, 'restore')}>Restore</button>}{item.lifecycle !== 'deleted' && <button onClick={() => void changeLifecycle(item, 'delete')}>Delete</button>}</div></footer></article>)}</div>
      <form className="panel compact-form" onSubmit={(event) => void submit(event)}><p className="kicker">ADD SIGNAL</p><h2>ナレッジを登録</h2><label>JSON / JSONL import<input type="file" accept=".json,.jsonl,application/json,application/x-ndjson" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importMetadata(file); }} /></label><label>タイトル<input name="title" required minLength={2} /></label><label>要約<textarea name="summary" required minLength={8} rows={3} /></label><label>種別<select name="kind"><option value="pattern">pattern</option><option value="principle">principle</option><option value="reference">reference</option><option value="anti-pattern">anti-pattern</option></select></label><label>文脈<input name="contexts" placeholder="landing-page, finance" required /></label><label>コンセプト<input name="concepts" placeholder="信頼感, clarity" required /></label><label>根拠<textarea name="evidence" required minLength={4} rows={3} /></label><label>Source type<select name="sourceType"><option value="human">human</option><option value="url">url</option><option value="figma">figma</option><option value="html">html</option><option value="generated">generated</option></select></label><label>Source URI<input name="sourceUri" type="url" /></label><label>License<input name="license" placeholder="MIT, CC BY 4.0, owned…" /></label><label>Rights<select name="rightsStatus"><option value="unverified">unverified</option><option value="verified">verified</option><option value="prohibited">prohibited</option></select></label><label className="checkbox-label"><input name="trainingEligible" type="checkbox" /> Training datasetへ利用可能</label><label>Reference image<input name="asset" type="file" accept="image/jpeg,image/png,image/webp" /></label><button className="primary-button">登録する</button>{message && <p className="form-message">{message}</p>}</form></section>
    </div>
  );
}

function IllustrationStudio({ data }: { data: AppData }) {
  return <div className="view-stack"><header className="page-heading"><div><p className="kicker">ILLUSTRATION / 04</p><h1>画風を仕様にして、<br />ムラを減らす。</h1></div><p>承認済み・不採用事例をStyle Profileに結び、生成条件と判断理由を追跡します。</p></header><section className="style-grid">{data.styles.map((style) => <article className="style-card" key={style.id}><div className="palette">{style.palette.map((color) => <span style={{ background: color }} title={color} key={color} />)}</div><p className="kicker">STYLE PROFILE · V{style.version}</p><h2>{style.name}</h2><p>{style.description}</p><dl><div><dt>Medium</dt><dd>{style.medium}</dd></div><div><dt>Traits</dt><dd>{style.traits.join(' · ')}</dd></div><div><dt>Avoid</dt><dd>{style.forbiddenTraits.join(' · ')}</dd></div></dl></article>)}</section></div>;
}

function ReviewStudio({ data, refresh }: { data: AppData; refresh: () => Promise<void> }) {
  const [rationale, setRationale] = useState('要件への適合度と情報階層がより明確だったため。');
  const [message, setMessage] = useState<string | null>(null);
  const [artifactAId, setArtifactAId] = useState<string | null>(null);
  const [artifactBId, setArtifactBId] = useState<string | null>(null);
  const candidates = useMemo(() => {
    const plans = new Map(data.plans.map((plan) => [plan.id, plan]));
    return data.runs.flatMap((run) => {
      const plan = plans.get(run.planId);
      const artifact = run.artifacts.find((item) => item.kind === 'html');
      return plan && artifact ? [{ artifact, plan }] : [];
    });
  }, [data.plans, data.runs]);
  const familyId = candidates.find((candidate) =>
    candidates.filter((item) => item.plan.familyId === candidate.plan.familyId).length >= 2,
  )?.plan.familyId;
  const familyCandidates = candidates
    .filter((candidate) => candidate.plan.familyId === familyId)
    .sort((left, right) => left.plan.candidateIndex - right.plan.candidateIndex);
  const candidateA = familyCandidates.find((candidate) => candidate.artifact.id === artifactAId)
    ?? familyCandidates[0];
  const candidateB = familyCandidates.find((candidate) =>
    candidate.artifact.id === artifactBId && candidate.artifact.id !== candidateA?.artifact.id,
  ) ?? familyCandidates.find((candidate) => candidate.artifact.id !== candidateA?.artifact.id);
  const pair = candidateA && candidateB ? [candidateA, candidateB] : [];
  async function prefer(artifactId: string): Promise<void> {
    if (pair.length < 2 || !pair[0]) return;
    try {
      await api('/api/comparisons', { method: 'POST', body: JSON.stringify({ requestId: pair[0].plan.requestId, artifactAId: pair[0].artifact.id, artifactBId: pair[1]?.artifact.id, preferredArtifactId: artifactId, rationale }) });
      setMessage('比較判断を保存しました。');
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : '保存に失敗しました。'); }
  }
  return <div className="view-stack"><header className="page-heading"><div><p className="kicker">EVALUATE / 05</p><h1>スコアより先に、<br />選んだ理由を残す。</h1></div><p>絶対評価と比較評価を分け、コンセプトごとの選択傾向を蓄積します。</p></header>
    {pair.length >= 2 ? <><section className="panel comparison-picker"><label>Candidate A<select value={pair[0]?.artifact.id} onChange={(event) => setArtifactAId(event.target.value)}>{familyCandidates.filter((candidate) => candidate.artifact.id !== pair[1]?.artifact.id).map((candidate) => <option value={candidate.artifact.id} key={candidate.artifact.id}>{candidate.plan.variantStrategy}</option>)}</select></label><label>Candidate B<select value={pair[1]?.artifact.id} onChange={(event) => setArtifactBId(event.target.value)}>{familyCandidates.filter((candidate) => candidate.artifact.id !== pair[0]?.artifact.id).map((candidate) => <option value={candidate.artifact.id} key={candidate.artifact.id}>{candidate.plan.variantStrategy}</option>)}</select></label></section><section className="compare-grid">{pair.map(({ artifact, plan }, index) => <article className="compare-card" key={artifact.id}><header><div><span>Candidate {String.fromCharCode(65 + index)} · {plan.variantStrategy}</span><small>{plan.generation.provider} · {plan.generation.model} · responsive desktop/mobile · content complete</small></div><button onClick={() => void prefer(artifact.id)}>こちらを選ぶ</button></header><iframe src={`/artifacts/${artifact.path}`} title={`Candidate ${String.fromCharCode(65 + index)}: ${plan.variantStrategy}`} /></article>)}</section><section className="panel review-reason"><label>選択理由<textarea value={rationale} onChange={(event) => setRationale(event.target.value)} rows={3} /></label>{message && <p className="form-message">{message}</p>}</section></> : <EmptyState>比較には同じPlan Familyの互換HTML候補が2件必要です。CreateからLocal候補を生成してください。</EmptyState>}
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
    figmaDeliveries: [],
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [config, summary, knowledge, requests, plans, runs, evaluations, styles, aiRuns, figmaDeliveries] = await Promise.all([
        api<PublicConfig>('/api/config'), api<DashboardSummary>('/api/dashboard'), api<KnowledgeItem[]>('/api/knowledge'), api<DesignRequest[]>('/api/requests'), api<DesignPlan[]>('/api/plans'), api<CreationRun[]>('/api/runs'), api<Evaluation[]>('/api/evaluations'), api<StyleProfile[]>('/api/style-profiles'), api<AiRun[]>('/api/ai-runs'), api<FigmaDelivery[]>('/api/figma-deliveries'),
      ]);
      setData({ config, summary, knowledge, requests, plans, runs, evaluations, styles, aiRuns, figmaDeliveries });
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

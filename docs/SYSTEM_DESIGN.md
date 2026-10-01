# XDB System Design

## 1. Purpose

XDBは、人間が良いと判断したデザインを、見た目だけでなく要件、対象、目的、コンセプト、判断理由、出典と結び付けて再利用するlocal-firstのDesign Intelligence基盤です。

中心となる成果物は画像やFigma fileではなく、根拠と履歴を持つ`DesignPlan`です。HTML、Figma、illustrationは同じPlanから生成される派生成果物として扱います。

```text
Human request
    |
    v
DesignRequest -> Research retrieval -> DesignPlan
                                      /    |     \
                                     v     v      v
                                  HTML   Figma   Illustration
                                     \     |      /
                                      v    v     v
                                  Evaluation / Comparison
                                           |
                                           v
                                  Contextual Knowledge
```

## 2. Goals and non-goals

### Goals

- 人間の評価理由を文脈付きknowledgeとして保存する。
- 同じ入力と同じversionのknowledgeから追跡可能なPlanを生成する。
- Local plannerと外部AI providerを交換可能にする。
- HTML、Figma、illustration間で共通のsemantic tokenと構造を使う。
- 自動構造評価と人間の美的評価を混同しない。
- provider未接続、部分失敗、fallbackを成功として隠さない。
- JSON／JSONL exportにより将来の分析・機械学習へ移行できるようにする。

### Non-goals

- FigmaとHTMLの完全な双方向同期。
- 初期段階での独自機械学習model。
- 出典・権利未確認素材の学習利用。
- 認証なしのpublic SaaS運用。
- provider固有IDをcanonical domain modelの正本にすること。

## 3. Design principles

1. **Plan is canonical**: Figma、HTML、画像はPlanから生成されるversion付きartifactとする。
2. **Evidence before score**: scoreだけでなく、判断理由、文脈、比較対象、provenanceを保存する。
3. **Provider-neutral core**: Claude、将来の別LLM、local plannerをdomainから分離する。
4. **Human approval is distinct**: 自動評価の`approved`を人間承認数へ含めない。
5. **Explicit partial failure**: 外部adapter未接続やfallbackをstatusとauditへ残す。
6. **Local-first and portable**: SQLiteとfilesystemを既定とし、JSON／JSONLで移行可能にする。
7. **No secret persistence**: credentialをDB、artifact、prompt log、Gitへ保存しない。
8. **Context over global averages**: 業種、対象、目的、concept、媒体が異なる評価を一つの平均へ潰さない。

## 4. System context

```text
┌──────────────────────┐
│ Human / Claude /     │
│ Codex / future agent │
└──────────┬───────────┘
           │ HTTP today / MCP planned
           v
┌─────────────────────────────────────┐
│ XDB API                             │
│ Intent -> Research -> Planning      │
│        -> Creation -> Evaluation    │
└──────┬──────────────┬───────────────┘
       │              │
       v              v
┌──────────────┐  ┌───────────────────┐
│ SQLite       │  │ ArtifactStore     │
│ relationships│  │ HTML/JSON/scripts │
└──────────────┘  └───────────────────┘
       │
       ├──────── optional ───────> Anthropic Messages API
       ├──────── optional ───────> Figma MCP
       └──────── future ────────> Image provider / Python ML worker
```

外部providerはoptional adapterです。XDB API、SQLite、HTML生成は外部接続なしで動作しなければなりません。

## 5. Module boundaries

| Module | Responsibility | Current source |
| --- | --- | --- |
| Shared contracts | Request、Plan、token、artifact、evaluationのvalidation | `src/shared/contracts.ts` |
| Intent | design requestかどうかの判定 | `src/server/domain/intent.ts` |
| Research | knowledge保存と文脈ranking | `src/server/domain/knowledge-ranking.ts` |
| Planning | Local Plan生成とprovider routing | `src/server/domain/planner.ts`, `src/server/ai/` |
| Creation | Planからadapterを実行してartifact化 | `src/server/domain/creation.ts` |
| HTML adapter | semantic／responsive HTML生成 | `src/server/adapters/html.ts` |
| Figma adapter | operation planと実行script生成 | `src/server/adapters/figma.ts` |
| Evaluation | 構造評価と人間評価の保存 | `src/server/domain/evaluation.ts` |
| Repository | SQLiteへの永続化と取得 | `src/server/db/` |
| Artifact store | file保存とSHA-256 integrity | `src/server/artifacts/store.ts` |
| Agent guidance | Claude／Codex共通workflow | `CLAUDE.md`, `skills/xdb-design-intelligence/` |

Domain層はHTTP、Figma node、Anthropic response shapeへ直接依存させません。provider固有responseはadapter内でshared contractへ変換します。

## 6. Canonical data model

### Entities

| Entity | Role | Important invariants |
| --- | --- | --- |
| `DesignRequest` | 人間の要望と生成条件 | audience、objective、concepts、avoid、output modeを必須化 |
| `KnowledgeItem` | 再利用可能な判断根拠 | contexts、concepts、evidence、provenanceを保持 |
| `StyleProfile` | illustrationの一貫性定義 | medium、traits、palette、composition、forbidden traitsをversion管理 |
| `DesignPlan` | canonical design specification | request、knowledge、generation providerへ追跡可能 |
| `CreationRun` | Planからの出力試行 | requested outputとstatusを保持 |
| `Artifact` | HTML、Figma plan/script、仕様、report | run ID、path、SHA-256を保持 |
| `Evaluation` | 一成果物への絶対評価 | automaticとhumanを分離 |
| `PairwiseComparison` | 二候補の比較判断 | preferred artifactはA/Bのどちらか |
| `AiRun` | Planning provider監査 | provider、model、token、latency、fallback、errorを保持 |
| `ToolRun` | 外部adapter実行監査 | idempotency keyとrequest／response／errorを保持 |

### Relationships

```text
DesignRequest 1 --- n DesignPlan
DesignRequest 1 --- n AiRun
DesignRequest 1 --- n PairwiseComparison
DesignPlan    1 --- n CreationRun
CreationRun   1 --- n Artifact
Artifact      1 --- n Evaluation
StyleProfile  1 --- n DesignPlan.illustration
KnowledgeItem n --- n DesignPlan (knowledgeIds)
```

`knowledgeIds`は現在Plan JSON内に保持します。検索・分析量が増え、joinや部分更新が必要になった段階で中間tableへmigrationします。初期段階で二重の正本は持ちません。

## 7. State and status model

### Design Request

```text
draft -> planned -> generated -> reviewed
```

- `draft`: validation済みだがPlan未生成。
- `planned`: 少なくとも一つのPlanが保存済み。
- `generated`: 少なくとも一つのCreation Runを実行済み。partial runの場合もrunの存在を示すため遷移するが、artifact単位の完了判定は別に見る。
- `reviewed`: 人間評価または比較判断が記録済み。

現在の実装は`draft -> planned -> generated`までを自動更新します。`reviewed`への遷移は、EvaluationからArtifact -> Creation Run -> Design Plan -> Design Requestのlineageを検証して更新する処理と一緒に次フェーズで実装します。

### Creation Run

| Status | Meaning |
| --- | --- |
| `completed` | 要求したadapterがすべて完了 |
| `partial` | 一部だけ完了。例: HTML成功、Figma未接続 |
| `blocked_external` | 外部接続・権限・対象file不足で開始不可 |
| `failed` | 開始後にvalidationまたはadapter実行が失敗 |

### AI Run

| Status | Meaning |
| --- | --- |
| `completed` | 指定providerの結果をvalidationして採用 |
| `fallback` | 指定providerが失敗し、許可されたLocal Planを採用 |
| `failed` | provider失敗かつfallback不許可 |

fallbackした`DesignPlan.generation.provider`は`local`、`fallbackUsed`は`true`です。要求providerは`AiRun.provider`から確認します。

## 8. Core workflows

### 8.1 Request and Research retrieval

1. raw inputをintent classifierへ渡す。
2. `non-design`はDesign Requestとして保存しない。
3. requestをZodで検証して保存する。
4. audience、objective、concepts、avoid、promptとknowledge metadataの一致をscore化する。
5. 上位knowledgeだけをPlanning contextへ渡す。

Rankingは現在決定的です。将来modelを導入しても、取得したknowledge IDとmodel versionをPlan／runへ残します。

### 8.2 Local Planning

1. Design Request、ranked knowledge、Style Profileを入力する。
2. section、semantic token、illustration specを決定的に生成する。
3. `generation.provider = local`として保存する。
4. token使用量を`null`としたAiRunを記録する。

Local plannerはoffline fallbackであると同時に、外部providerの回帰比較基準です。

### 8.3 Claude Planning

1. `XDB_ANTHROPIC_API_KEY`、`XDB_ANTHROPIC_MODEL`、provider enablementを確認する。
2. Request、ranked knowledge、Style Profileを構造化してMessages APIへ送る。
3. `submit_design_plan` tool callを強制する。
4. tool inputをZodで検証する。
5. ID、request ID、knowledge IDs、Style Profile ID、timestampをserver側で付与する。
6. provider、model、input/output token、latencyをAiRunへ記録する。
7. timeout、HTTP error、tool欠落、不正schema時は設定に従ってLocalへfallbackする。

Claudeへserver-owned ID、権限、実行成功状態を決めさせません。credential、prompt全文、response全文はAiRunへ保存しません。

### 8.4 Creation

1. output modeとadapter enablementを確認する。
2. Creation Runを作成する。
3. HTML、Figma plan/script、Illustration Specを必要な範囲で生成する。
4. ArtifactStoreがfileを書き、SHA-256を算出する。
5. artifact metadataをDBへ保存する。
6. 自動構造評価reportを生成する。
7. adapter結果からrun statusを確定する。

外部adapterの実行前にはidempotency keyを確定し、同一操作の二重適用を避けます。

### 8.5 Evaluation feedback

1. automatic evaluatorは観測可能な構造だけを評価する。
2. human evaluatorは見た目、concept fit、文脈適合、採否と理由を記録する。
3. pairwise comparisonは同じ評価目的で比較可能な候補だけを対象にする。
4. comparisonから直接普遍ルールを作らず、request文脈と共にResearchへ返す。
5. 十分な反復で安定した傾向だけをpattern／principle候補へ昇格する。

現在の比較APIはpreferred artifactがA/BのどちらかであることをDB制約で保証しています。同一Request由来か、同じviewport／content completenessかの検証はMultiple Candidateフェーズで追加します。それまでは比較結果を機械学習labelとして自動採用しません。

## 9. API design

### Current HTTP API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | processと外部adapter接続状態 |
| `GET /api/config` | secretを除くdesign設定とcapability |
| `GET /api/dashboard` | Request、Plan、Run、評価等の集計 |
| `POST /api/hooks/design-input` | design intent判定 |
| `GET/POST /api/knowledge` | knowledge取得・登録 |
| `GET/POST /api/style-profiles` | Style Profile取得・登録 |
| `GET/POST /api/requests` | Design Request取得・登録 |
| `GET/POST /api/plans` | Plan取得・provider指定生成 |
| `GET /api/ai-runs` | provider実行監査 |
| `GET/POST /api/runs` | Creation Run取得・実行 |
| `GET/POST /api/evaluations` | 絶対評価取得・登録 |
| `GET/POST /api/comparisons` | 比較評価取得・登録 |
| `GET /api/export` | version付き全domain export |
| `GET /api/export/evaluations.jsonl` | 評価event export |

生成artifactは`/artifacts/`配下でlocal previewへ配信します。public deploymentでは認証・公開範囲・cache policyを別途定義するまで、この経路を外部公開しません。

### Planned MCP facade

MCPは新しい正本やbusiness logicを持たず、HTTP application serviceと同じuse caseを呼ぶthin adapterとします。

初期tool候補：

- `xdb_classify_design_input`
- `xdb_search_knowledge`
- `xdb_create_request`
- `xdb_create_plan`
- `xdb_create_artifacts`
- `xdb_record_evaluation`
- `xdb_compare_artifacts`
- `xdb_get_run_status`

MCP responseは巨大なHTMLやbinaryを直接返さず、summary、ID、resource URI、次に必要なactionを返します。write toolはreadと分離し、外部Figma writeを暗黙実行しません。

## 10. Output adapter design

### HTML

- standalone semantic HTMLを生成する。
- desktop/mobileのresponsive ruleを含める。
- preview artifactは`noindex,nofollow`を持つ。
- heading、landmark、action label、contrastを検証対象にする。
- script実行を必須にしない。

### Figma

- 既存fileを対象とし、新規fileを暗黙作成しない。
- 実行前にpage、既存screen、component、variable、styleを探索する。
- Code Connect、既存instance、library searchの順に再利用候補を探す。
- Auto Layoutとvariable bindingを優先する。
- desktop 1440pxとmobile 390pxを生成・検証する。
- 作成・変更node IDを返し、screenshotとstructural inspectionで検証する。
- 未接続時はoperation planとscriptを残し、実行済みとは表示しない。

### Illustration

- Style Profileを必須とする。
- purpose、subject、aspect ratio、focal point、copy safe area、required、avoidを固定する。
- provider、model/version、seed相当値、入力仕様、生成日時を取得可能な範囲で記録する。
- acceptedとrejectedの両方を理由付きで保持する。
- mobile crop、copy overlap、palette逸脱、主題不明瞭をreject対象にする。

## 11. Multiple candidate design

次フェーズでは、同一Requestから複数候補を生成できるようにします。

```text
DesignRequest
  -> Plan family
      -> Candidate A: conservative / evidence-led
      -> Candidate B: expressive / brand-led
      -> Candidate C: compact / conversion-led
```

候補差分はrandomnessだけにせず、`variantStrategy`、`candidateIndex`、`provider`、`model`、`knowledgeIds`を保存します。比較対象は同じRequest、同じ目的、互換viewport、同じcontent completenessを満たす必要があります。

同一HTMLを再生成しただけの候補は比較学習へ使用しません。artifact hashとPlan差分で重複を除外します。

## 12. Storage and migration

### Current

- SQLite: relation、status、score、provenance、audit。
- Filesystem: HTML、JSON、Figma script、report。
- SHA-256: artifact integrity。
- `schema_migrations`: transaction単位のforward migration。

### Backup unit

SQLiteと`.data/artifacts/`を同じ時点の一組としてbackupします。DBだけ、artifactだけを個別にrestoreしません。

### Future PostgreSQL boundary

multi-user、concurrent worker、remote deployment、large-scale retrievalが必要になるまではSQLiteを維持します。移行時はshared contractとexport versionを保ち、repository implementationを交換します。

## 13. Configuration hierarchy

| Configuration | Location | Examples |
| --- | --- | --- |
| Versioned behavior | `design.config.json` | output modes、provider enablement、timeout、human approval |
| Secret／environment | `.env` or process env | API key、model ID、database path、base URL |
| Canonical validation | Zod + JSON Schema | enum、limit、required field |
| User request | API payload | audience、objective、concepts、output mode |

secretやaccount固有値を`design.config.json`へ置きません。環境変数がないproviderは未接続として扱います。

## 14. Security, privacy, and rights

- API key、session token、Figma credentialをchat、Git、DB、artifactへ保存しない。
- promptやreferenceに個人情報・機密情報が含まれる可能性を前提に、外部provider送信を明示選択にする。
- external base URL変更時はcredential送信先が変わるため、allowlistまたは明示確認を導入する。
- provenanceにsource URI、license、captured time、training eligibilityを保持する。
- `trainingEligible`の既定はfalseとする。
- XDBのMIT Licenseは、登録された画像、font、Figma component、AI出力の第三者権利を許諾しない。
- public化前にauthentication、authorization、rate limit、request size、audit、deletion workflowを追加する。

## 15. Cost controls

外部AI／画像providerは、credentialが存在するだけでは無制限利用可能とみなしません。

必要な制御：

- request単位のmax output token。
- timeoutとretry上限。
- 月次budgetと停止条件。
- provider／modelごとのusage集計。
- batchや複数candidate生成前の推定消費表示。
- external callを伴わないLocal preview。
- timeout、429、5xx時のretryとfallbackを区別したaudit。

retryはidempotentなPlanning read／generationに限定し、Figma writeを自動retryしません。

## 16. Failure design

| Failure | Behavior | User-visible result |
| --- | --- | --- |
| Invalid request | 保存しない | validation error |
| Non-design input | workflowを開始しない | intentとignore action |
| Claude未接続 | 設定に従いLocal fallbackまたは503 | actual providerを表示 |
| Claude schema不正 | responseを採用しない | fallback／failed audit |
| HTML generation failure | artifactを保存しない | run failed |
| Figma未接続 | plan/scriptだけ保存 | partial／blocked_external |
| Figma途中失敗 | node IDsとerrorを記録 | retry前にtarget inspection |
| Image provider未接続 | Illustration Specだけ保存 | generated imageと表示しない |
| Artifact hash mismatch | preview／exportを停止 | integrity error |
| DB migration failure | transaction rollback | process start failure |

## 17. Observability

最低限追跡する指標：

- Request、Plan、Run、Artifact、Evaluationの件数。
- provider別Planning成功、fallback、失敗率。
- provider／model別tokenとlatency。
- Figma／HTML／image adapter別完了率。
- human approval、reject、revise比率。
- comparisonの文脈別選択傾向。
- artifact生成からhuman reviewまでの時間。

prompt本文やcredentialをmetric labelへ含めません。個人運用段階ではDB auditとlocal logを使用し、外部monitoringは公開要件確定後に追加します。

## 18. Test strategy

### Unit

- intent classification。
- knowledge ranking。
- Local Plan generation。
- Claude tool result validationとserver-owned lineage。
- HTML／Figma adapter output。
- structural evaluation。

### Integration

- Request -> Plan -> Run -> Evaluation。
- Claude未接続fallbackとAiRun audit。
- migration from previous schema version。
- output adapter disabled／missing target failure。
- JSON／JSONL export compatibility。

### Browser

- desktop 1440pxとmobile 390px。
- 横overflow、clipped text、console／page error。
- Local／Claude選択とactual provider表示。
- HTML candidate previewとcomparison操作。

### External adapter acceptance

- Claude: 1 request限定でschema、token、latency、cost、fallbackを実測。
- Figma: isolated test fileでnode IDs、Auto Layout、variable、desktop/mobile screenshotを検証。
- Image: small candidate setでStyle Profile一致、crop、safe area、reject reasonを確認。

## 19. Delivery sequence

| Phase | Estimate | Scope | Exit criteria |
| --- | ---: | --- | --- |
| 1. Claude live validation | 1–2 days | model、cost gate、one-request live test | validated Plan、usage、fallback audit |
| 2. MCP facade | 2–3 days | shared read/write tools | Claude Code／Codexから同じuse caseを実行 |
| 3. Candidate comparison | 2–3 days | Plan family、variant、lineage、dedupe | 同一Requestの有効なA/B比較 |
| 4. Figma live adapter | 2–4 days | discovery、native nodes、validation | editable desktop/mobile Figma output |
| 5. Research import | 2–3 days | provenance、license、dedupe、labels | safe contextual knowledge dataset |
| 6. Operational evaluation | 1–2 days | multiple real briefs | measured quality、cost、failure backlog |

日程は外部account、Figma file、review待ちを除く開発目安です。進捗、実績、変更判断はGit外のtasks-mdへ記録します。

## 20. Machine learning boundary

Python ML workerは以下が満たされた後に追加します。

- human comparisonが複数の主要contextで継続的に得られる。
- evaluator間のscore定義と判断理由が安定している。
- duplicate、license不明、training不可データを除外できる。
- deterministic rankingを上回るoffline evaluation方法が定義されている。
- model version、feature version、training dataset snapshot、rollbackを記録できる。

構成予定：

```text
TypeScript XDB
  -> versioned JSONL snapshot
      -> Python training/evaluation worker
          -> versioned ranking artifact
              -> TypeScript inference adapter or isolated Python service
```

Python workerはDBへ直接書き込まず、version付きexportを入力、評価reportとmodel artifactを出力します。model結果だけでhuman approvalを上書きしません。

## 21. Documentation boundary

Gitへ含めるもの：

- 公開可能で長期有効なsystem design。
- API、data、adapter、security、migration、test方針。
- 利用者向け導入・運用手順。

Gitへ含めないもの：

- 日々の進捗チェック。
- 作業中の仮説、review回数、担当状況。
- 外部実行の利用量・一時的な検証証跡。
- credential、account固有情報、未公開URL。

進行管理は`~/tasks-md/`で行い、repository内へtasks fileを作りません。

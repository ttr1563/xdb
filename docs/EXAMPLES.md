# 実施例

ここでは、追加費用のないLocal workflowから始め、Research、MCP、Figmaへ段階的に広げます。

## 例1：Web UIだけでLP候補を作る

### 入力

| 項目 | 値 |
| --- | --- |
| Project | Invoice Flow |
| 要望 | 個人事業主向け請求書サービスのLP。信頼感は必要だが堅すぎない |
| Audience | ITに詳しくない個人事業主 |
| Objective | 無料登録への誘導 |
| Concepts | 信頼感、親しみ、簡単さ |
| Avoid | 情報過多、過度な3D |
| Planning AI | Local |
| Output | HTML |

### 操作と結果

Createから実行すると、同じRequestに属する3つのPlanとHTML候補が作られます。Reviewで候補A/Bを選び、「主要CTAと価値提案の関係が明確」など観測した理由を保存します。

この例ではAnthropic、Figma、画像生成providerを呼びません。

## 例2：starter researchを入れてから作る

1. ResearchのJSON／JSONL importで`examples/research/design-systems-starter.jsonl`を選ぶ。
2. 12件の作成・重複・拒否件数を確認する。
3. Createで対象、目的、conceptを具体的に入力する。
4. Local HTMLを生成する。
5. Plan detailのKnowledge lineageを確認する。

starter packは`trainingEligible: false`ですが、activeな通常retrievalには利用できます。

## 例3：Codexで参考URLを調査する

Createで次を入力します。

```text
inspiration https://designsystem.digital.gov/design-principles/
avoid https://example.com/avoid-reference
```

Request保存後、Planningはreference確定待ちになります。Codexへ次のように依頼します。

```text
XDB MCPで最新Requestのreferenceを一覧してください。
各URLは一次資料として内容を確認し、事実と観察を分けてanalysisを記録してください。
公開されていることだけを理由に権利確認済み・学習利用可とはしないでください。
採否はまだ確定せず、reference IDと要約、strengths、risksを提示してください。
```

人間が内容を確認した後：

```text
先ほどのinspiration referenceは設計参考として承認し、avoid referenceはanti-patternとして承認してください。
判断理由をそれぞれ記録してください。全referenceがfinalになったことを確認してから、Local Planを作ってください。
```

AIが勝手に承認しないよう、最初の依頼と人間の判断を分けるのが重要です。

現在のWeb UIはreferenceの状態表示までです。分析・採否・既存RequestのPlan生成はCodex等のMCP clientまたはHTTP APIで行います。

## 例4：HTTP APIでLocal Planを作る

APIを起動してからDesign Requestを作ります。

```console
curl -X POST http://127.0.0.1:4310/api/requests \
  -H 'Content-Type: application/json' \
  -d '{
    "prompt":"個人事業主向け会計サービスのLPをデザインしてください",
    "projectName":"Ledger Light",
    "audience":"ITに詳しくない個人事業主",
    "objective":"無料登録への誘導",
    "concepts":["clarity","trustworthy"],
    "avoid":["information overload"],
    "references":[],
    "outputMode":"html"
  }'
```

responseの`id`を`REQUEST_ID`へ置き換えてPlan Familyを作ります。

```console
curl -X POST http://127.0.0.1:4310/api/plan-families \
  -H 'Content-Type: application/json' \
  -d '{"requestId":"REQUEST_ID"}'
```

response内の各Plan `id`を使ってartifactを作ります。

```console
curl -X POST http://127.0.0.1:4310/api/runs \
  -H 'Content-Type: application/json' \
  -d '{"planId":"PLAN_ID","outputMode":"html","figmaFileKey":null}'
```

これはlocal single-user APIです。認証を追加せず外部networkへ公開しないでください。

## 例5：Figmaへ渡す

1. Createで`Figma`または`Both`を選ぶ。
2. write権限のある既存Figma file keyを入力する。
3. XDBでPlanとFigma operation artifactを生成する。
4. Figma接続済みagentが既存variables／componentsを調査してnative nodeを作る。
5. desktop/mobile screenshotと構造を確認する。
6. 作成・変更・観測node IDを`xdb_record_figma_delivery`で記録する。

Figma MCPが未接続の場合、operation artifactは残りますがrunは`partial`または`blocked_external`です。接続済みという事実だけでcompletedにはしません。

# 利用ガイド

XDBはAI chatそのものではなく、デザインの要望、参考情報、Plan、生成物、人間の評価を同じlineageで保存するlocal-firstの研究環境です。ClaudeやFigmaを接続しなくても、Local plannerとHTML生成を利用できます。

## 画面構成

| 画面 | 用途 |
| --- | --- |
| Overview | 件数、最新run、artifact、AI実行履歴を確認 |
| Create | Design Request、Planning provider、出力先を指定 |
| Research | Knowledge、参考URLの状態、出典、権利、除外状態を管理 |
| Illustration | Style Profileと一貫性条件を確認 |
| Review | 同じPlan FamilyのHTML候補を比較し、人間の選択理由を保存 |

## 最短の使い方：Local HTML候補を作る

1. `npm run dev`で起動し、`http://127.0.0.1:4311`を開く。
2. Createでproject名、要望、対象ユーザー、目的、concept、避ける表現を入力する。
3. Planning AIを`Local`、出力を`HTML`にする。
4. 参考URLは空のまま「一連の生成を実行」を押す。
5. Local plannerが`conservative`、`expressive`、`conversion-led`の3候補を作る。
6. Overviewのartifact linkまたはReviewで結果を確認する。
7. Reviewで2候補を選び、理由を書いて優先案を保存する。

Local plannerは外部AI APIを呼びません。保存されたPlanの`generation.provider`も`local`になります。

## 参考URLを使う

Createの参考URL欄は1行1件です。roleを省略すると`inspiration`になります。

```text
inspiration https://example.com/good-reference
competitor https://example.com/competitor
avoid https://example.com/do-not-copy
existing https://example.com/current-site
```

参考URLがある場合、XDBはRequestを保存したところで生成を停止します。XDB serverはURLを取得しません。

1. Codexなど、利用者が外部閲覧を許可したresearch clientでURLを確認する。
2. clientが`xdb_record_reference_analysis`でtitle、summary、contexts、concepts、strengths、risks、evidence、権利状態を保存する。
3. 人間が内容を確認する。
4. 人間の判断に基づき、clientが`xdb_review_request_reference`で`approved | rejected | unavailable`を確定する。
5. 全referenceがfinalになった後、MCPの`xdb_create_plan`／`xdb_create_plan_family`または`POST /api/plans`／`POST /api/plan-families`で同じRequestからPlanを生成する。

承認したreferenceだけがKnowledgeへ変換され、Request固有のretrievalで優先されます。`avoid`を承認した場合はanti-patternになります。公開ページであることだけを理由に`rightsStatus: verified`や`trainingEligible: true`へ変更しないでください。

現時点のWeb UIはreference queueの確認までで、analysis、採否、既存RequestのPlan再開buttonはありません。参考URLworkflowはMCPまたはHTTP APIから継続してください。参考URLなしのRequestはWeb UIだけで生成まで完了できます。

## Research starter packを入れる

1. Researchを開く。
2. 「JSON / JSONL import」で`examples/research/design-systems-starter.jsonl`を選ぶ。
3. import結果の作成、重複、拒否件数を確認する。
4. 各Knowledgeのsource、rights、contextを確認する。

starter packは通常retrievalへ利用できますが、権利状態を確認していないためtraining snapshotには入りません。

## 出力先の違い

| 出力 | 結果 | 追加接続 |
| --- | --- | --- |
| `html` | responsive standalone HTML、illustration spec、review report | 不要 |
| `figma` | Figma operation plan／script。外部write完了まではpartialまたはblocked | Figma接続と既存fileのwrite権限 |
| `both` | HTMLとFigma用artifact | Figma側だけ追加接続が必要 |

Figmaを選んでも、接続しただけではcompletedになりません。desktop/mobile node、構造監査、screenshot確認を`FigmaDelivery`として記録したときだけ完了します。

## Knowledgeを登録する

最低限、次を人間が判断します。

- 何が良い、または避けるべきか
- どのcontextで有効か
- どのconceptと関係するか
- 判断の根拠
- sourceとcapture日時
- licenseと学習利用可否

`exclude`はretrievalから一時除外し、後から戻せます。`delete`は本文、出典、参照画像を削除したtombstoneとなり、復元できません。

## Export

API起動中に次を取得できます。

- `/api/export`: 全domain data
- `/api/export/evaluations.jsonl`: 評価event
- `/api/export/dataset.jsonl`: 権利確認済み、学習利用可能なKnowledgeだけのsnapshot

機械学習へ渡す場合はdataset snapshotのSHA-256をrun記録へ残し、XDBのSQLiteをworkerから直接変更しないでください。

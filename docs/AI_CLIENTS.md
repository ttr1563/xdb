# AI client接続ガイド

XDBはlocal stdio MCP serverを提供します。AI clientは同じPC上のXDB processをchild processとして起動し、HTTP portを外部公開せずにtoolを利用できます。Anthropic API keyはMCP接続には不要です。

## 共通準備

```console
git clone https://github.com/ttr1563/xdb.git
cd xdb
npm install
cp .env.example .env
```

以下の例にある`/absolute/path/to/xdb`は、cloneしたXDBの絶対pathへ置き換えてください。relative pathはclientの起動directoryによって解決先が変わるため、repository外から起動するclientでは使用しません。

## Codex CLI

登録します。

```console
codex mcp add xdb -- \
  /absolute/path/to/xdb/node_modules/.bin/tsx \
  /absolute/path/to/xdb/src/server/mcp/main.ts
codex mcp get xdb
```

`enabled: true`とcommand／argsを確認し、新しいCodex sessionを開始します。登録前から開いていたsessionにはtoolが追加されません。

接続確認用の依頼例：

```text
XDB MCPだけを使用してください。xdb_classify_design_inputを呼び、
「小規模事業者向け会計サービスのLPを作りたい」を分類して結果を説明してください。
まだRequestやartifactは作成しないでください。
```

分類が返ればread toolの接続は完了です。writeを試す場合は[実施例](EXAMPLES.md)に従い、操作ごとに一意な`idempotencyKey`を使います。

登録を解除する場合：

```console
codex mcp remove xdb
```

## Claude Code

repository直下の`.mcp.json`にはproject-scope設定が含まれています。

```json
{
  "mcpServers": {
    "xdb": {
      "type": "stdio",
      "command": "./node_modules/.bin/tsx",
      "args": ["src/server/mcp/main.ts"]
    }
  }
}
```

XDB repositoryをClaude Codeで開き、project MCP serverを確認・承認します。

```console
claude mcp get xdb
```

Claude CodeからXDB MCPを使うだけならAnthropic Messages API用の`XDB_ANTHROPIC_API_KEY`は不要です。XDB内部のPlanning providerとしてClaudeを選ぶ場合だけ、別途[Claude provider](../skills/xdb-design-intelligence/references/claude-provider.md)の外部通信・予算設定が必要です。

## その他のstdio MCP client

clientがlocal stdio MCP serverを登録できる場合、次の情報を設定します。設定ファイル名やtop-level keyはclientごとに異なるため、そのclientのMCP documentationに合わせてください。

```json
{
  "name": "xdb",
  "transport": "stdio",
  "command": "/absolute/path/to/xdb/node_modules/.bin/tsx",
  "args": [
    "/absolute/path/to/xdb/src/server/mcp/main.ts"
  ]
}
```

XDBはremote HTTP MCP endpointを提供していません。remote URL入力欄へAPI URLを設定しても接続できません。

## AI clientを使わない

AI clientは必須ではありません。

- Web UI: `npm run dev`後に`http://127.0.0.1:4311`
- HTTP API: `http://127.0.0.1:4310/api/*`
- Local planner: external credentialなしで利用可能

参考URLの内容分析はXDB serverが実施しないため、そのworkflowだけは許可されたresearch clientで構造化分析を登録するか、HTTP APIへ人間が作成した分析payloadを送ります。

## MCP利用時の安全規則

- write toolごとに、意図した一操作を表す8〜128文字の`idempotencyKey`を付ける。
- 同じkeyを異なるpayloadへ再利用しない。
- timeoutやprocess停止後、別keyで即時再実行しない。Request、Plan、Run、artifactの保存状態を先に確認する。
- URLの閲覧権限、利用条件、機密性をXDBが保証すると考えない。
- Figma write、Claude API、画像providerはMCP接続とは別の権限・費用境界として扱う。
- tool resultのautomatic scoreを人間の承認として扱わない。

公開toolとdata contractは[XDB Skill](../skills/xdb-design-intelligence/SKILL.md)を参照してください。


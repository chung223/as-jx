# 哩程玩家工具箱 MCP Server

把站上的哩程資料與**計算能力**接給 AI 助理。零依賴、不需要 API 金鑰。

工具（8 個）：

| 工具 | 用途 |
|---|---|
| `stopover_combos` | 阿拉斯加×星宇：給外站，算出所有可免費中停台灣 14 天的組合與所需哩程 |
| `award_price` | 華航／長榮／星宇兌換哩程（華航含 2026/9/16 三段式動態與現行制） |
| `compare_programs` | 同目的地五家比較，可換算哩程取得成本（NT$） |
| `cathay_price` | 國泰按總距離計價，任兩機場自動加計香港轉機 |
| `four_leg_rules` | 三大航外站四段票票規 |
| `elite_status` | 會籍門檻與差距 |
| `latest_fare_scan` | 每日自動掃描的四段票同航司實際票價 |
| `list_airports` | 星宇航點與距台北／台中距離 |

資料以線上 `data.json` 為準（每次網站部署自動更新），取不到時退回 repo 內的副本。

## 用法 A：本機 stdio（推薦，零成本）

需要 Node 18+。把這個 repo clone 下來後：

**Claude Code**
```bash
claude mcp add miles-toolbox -- node /絕對路徑/as-jx/mcp/server.mjs
```

**Claude Desktop**（`claude_desktop_config.json`）
```json
{
  "mcpServers": {
    "miles-toolbox": {
      "command": "node",
      "args": ["/絕對路徑/as-jx/mcp/server.mjs"]
    }
  }
}
```

重開用戶端後即可問：「香港出發有哪些能免費中停台灣的組合？」「華航新制飛紐約商務要多少哩？」

## 用法 B：遠端 Worker（可分享給別人用）

Cloudflare Workers 免費方案即可（每日 10 萬次請求）。

```bash
npm i -g wrangler          # 或用 npx
cd mcp && npx wrangler deploy
```

部署後會拿到 `https://miles-toolbox-mcp.<你的帳號>.workers.dev`，
在支援遠端 MCP 的用戶端加入 `https://.../mcp` 即可（傳輸方式：Streamable HTTP）。

`GET /` 會回傳伺服器資訊，方便確認部署成功。

## 測試

```bash
# 手動打一次 tools/list
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node mcp/server.mjs
```

## 免責

哩程數字為公開資料整理值，各計畫隨時可能調整；開票前請以航空公司官網為準。

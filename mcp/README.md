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

Cloudflare Workers 免費方案即可（每日 10 萬次請求）。兩種部署方式擇一。

### B-1：用 GitHub Actions 部署（不必在本機裝東西）

1. 到 [Cloudflare 儀表板](https://dash.cloudflare.com) 註冊／登入（免費）
2. 右上角頭像 →「My Profile」→「API Tokens」→「Create Token」
   → 選範本 **Edit Cloudflare Workers** → 帳號選自己的 → 建立後複製那串 token（只顯示一次）
3. 回儀表板「Workers & Pages」，右側可看到 **Account ID**，複製起來
4. 到本 repo 的 Settings → Secrets and variables → **Actions** → New repository secret，新增兩筆：
   - `CLOUDFLARE_API_TOKEN`＝第 2 步的 token
   - `CLOUDFLARE_ACCOUNT_ID`＝第 3 步的 Account ID
5. Actions 分頁 →「Deploy MCP worker」→ **Run workflow**

跑完會在摘要看到「MCP server 上線，回報 8 個工具 — 端點 https://….workers.dev/mcp」。
之後只要 `mcp/` 有變更就會自動重新部署；沒設金鑰時會安靜跳過，不會寄失敗信。

### B-2：本機 wrangler

需要 Node 18+ 並先 clone 本 repo。

```bash
cd mcp
npx wrangler login     # 開瀏覽器授權（第一次）
npx wrangler deploy
```

### 已部署的端點

```
https://miles-toolbox-mcp.da70168.workers.dev/mcp
```

MCP 端點是 **`/mcp`**（根目錄只回伺服器資訊，方便確認活著）。
在支援遠端 MCP 的用戶端加入該網址即可（傳輸：Streamable HTTP）。

**Claude Code**
```bash
claude mcp add --transport http miles-toolbox https://miles-toolbox-mcp.da70168.workers.dev/mcp
```

```bash
# 手動確認
curl -X POST https://miles-toolbox-mcp.da70168.workers.dev/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## 測試

```bash
# 手動打一次 tools/list
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node mcp/server.mjs
```

## 免責

哩程數字為公開資料整理值，各計畫隨時可能調整；開票前請以航空公司官網為準。

#!/usr/bin/env node
/* 哩程玩家工具箱 MCP server（stdio）。零依賴，直接 `node mcp/server.mjs` 即可。
   Claude Desktop / Claude Code 設定範例見 mcp/README.md。 */
import { readFileSync } from 'node:fs';
import { handle } from './tools.mjs';

let bundled = { };
try { bundled = JSON.parse(readFileSync(new URL('../data.json', import.meta.url), 'utf8')); } catch { }

const send = o => process.stdout.write(JSON.stringify(o) + '\n');
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', async chunk => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0){
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); }
    catch { send({ jsonrpc:'2.0', id:null, error:{ code:-32700, message:'JSON 解析失敗' } }); continue; }
    try {
      const res = await handle(msg, bundled);
      if (res) send(res);
    } catch (e){
      send({ jsonrpc:'2.0', id: msg.id ?? null, error:{ code:-32603, message: e.message } });
    }
  }
});
process.stdin.on('end', () => process.exit(0));

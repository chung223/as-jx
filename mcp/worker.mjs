/* 同一組工具的 Cloudflare Worker 版（遠端 MCP，Streamable HTTP）。
   部署：npx wrangler deploy --config mcp/wrangler.toml
   之後把 https://<你的worker>.workers.dev/mcp 加到支援遠端 MCP 的用戶端即可。 */
import { handle } from './tools.mjs';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, mcp-protocol-version, mcp-session-id',
};

export default {
  async fetch(req){
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(req.url);
    if (req.method === 'GET')
      return Response.json({ name:'miles-toolbox', transport:'streamable-http', endpoint:'/mcp',
        docs:'https://chung223.github.io/as-jx/' }, { headers: CORS });
    if (req.method !== 'POST' || !url.pathname.endsWith('/mcp'))
      return new Response('Not found', { status:404, headers: CORS });
    let msg;
    try { msg = await req.json(); } catch {
      return Response.json({ jsonrpc:'2.0', id:null, error:{ code:-32700, message:'JSON 解析失敗' } },
        { status:400, headers: CORS });
    }
    // 批次請求
    if (Array.isArray(msg)){
      const out = (await Promise.all(msg.map(m => handle(m, {})))).filter(Boolean);
      return out.length ? Response.json(out, { headers: CORS }) : new Response(null, { status:202, headers: CORS });
    }
    const res = await handle(msg, {});
    return res ? Response.json(res, { headers: CORS }) : new Response(null, { status:202, headers: CORS });
  },
};

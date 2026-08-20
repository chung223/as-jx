/* 單一 PNR 多城市實價：Google Flights 的多城市頁價格由前端動態產生，
   靜態抓取拿不到，故用 Playwright 實際渲染後讀取。
   產出 multicity.json，供四段票分頁顯示「拆票 vs 單一 PNR」的差額。 */
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const AHEAD = +(process.env.DAYS_AHEAD || 45);
const base = new Date(Date.now() + AHEAD * 864e5);
const iso = d => d.toISOString().slice(0, 10);
const add = n => iso(new Date(base.getTime() + n * 864e5));
const D = { d1: add(0), d2: add(1), d3: add(8), d4: add(38) };

/* tfs protobuf 編碼（與站上 gfMultiUrl 同規格）：legs=[[起,迄,日期],…] */
function tfs(legs, seat, airline){
  const vint = n => { const o = []; while (n > 127){ o.push((n & 127) | 128); n >>= 7; } o.push(n); return o; };
  const str = (f, s) => { const b = [...Buffer.from(s, 'utf8')]; return [...vint(f << 3 | 2), b.length, ...b]; };
  const msg = (f, b) => [...vint(f << 3 | 2), b.length, ...b];
  const num = (f, v) => [...vint(f << 3), ...vint(v)];
  const info = [];
  for (const [o, d, dt] of legs)
    info.push(...msg(3, [...str(2, dt), ...(airline ? str(6, airline) : []),
      ...msg(13, str(2, o)), ...msg(14, str(2, d))]));
  info.push(...num(8, 1), ...num(9, seat), ...num(19, 3));   // 1 成人・艙等・多城市
  return Buffer.from(info).toString('base64url');
}

const MATRIX = [];
for (const [a, an] of [['HKG','香港'], ['MFM','澳門'], ['BKK','曼谷'], ['SGN','胡志明市'], ['CGK','雅加達']])
  for (const [b, bn] of [['NRT','東京成田'], ['KIX','大阪關西']])
    for (const [seat, cab] of [[1,'ECONOMY'], [3,'BUSINESS']])
      for (const [al, aln] of [['JX','星宇'], ['BR','長榮'], ['CI','華航']])
        MATRIX.push({ a, an, b, bn, seat, cab, al, aln });

const br = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
const ctx = await br.newContext({ locale: 'zh-TW', timezoneId: 'Asia/Taipei',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' });
const pg = await ctx.newPage();

const results = [];
for (const m of MATRIX){
  const legs = [[m.a, 'TPE', D.d1], ['TPE', m.b, D.d2], [m.b, 'TPE', D.d3], ['TPE', m.a, D.d4]];
  const url = `https://www.google.com/travel/flights?tfs=${tfs(legs, m.seat, m.al)}&hl=zh-TW&curr=TWD`;
  let price = null, err = null;
  try {
    await pg.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    // 等價格出現：Google 以 NT$ 呈現台幣
    await pg.waitForFunction(() => /NT\$[\d,]{4,}/.test(document.body.innerText), { timeout: 30000 });
    const prices = await pg.evaluate(() =>
      [...document.body.innerText.matchAll(/NT\$([\d,]+)/g)]
        .map(x => +x[1].replace(/,/g, '')).filter(v => v >= 3000 && v <= 900000));
    if (prices.length) price = Math.min(...prices);
    else err = '頁面無價格';
  } catch (e){ err = String(e.message).slice(0, 80); }
  results.push({ ...m, price, err, url });
  console.log(`${m.an}⇄${m.bn} ${m.cab === 'BUSINESS' ? '商務' : '經濟'} ${m.aln}：` +
    (price ? `NT$${price.toLocaleString('en-US')}` : `— ${err}`));
  await pg.waitForTimeout(2500);   // 對 Google 客氣一點
}
await br.close();

writeFileSync('multicity.json', JSON.stringify({
  scanned_at: new Date().toISOString().slice(0, 19) + 'Z',
  days_ahead: AHEAD, dates: D, note: '單一 PNR 多城市實價（Playwright 渲染 Google Flights）',
  results: results.map(({ url, ...r }) => r),
}, null, 1), 'utf8');
const ok = results.filter(r => r.price).length;
console.log(`\n多城市掃描完成：${ok}/${results.length} 組取得單一 PNR 報價`);

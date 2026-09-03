/* 哩程玩家工具箱 MCP：工具定義與計算邏輯（stdio 與 Cloudflare Worker 共用）。
   資料以站上 data.json 為準（隨頁面部署更新），取不到時退回隨附副本。 */
const SITE = 'https://chung223.github.io/as-jx/';
let cache = null, cacheAt = 0;

export async function loadData(bundled){
  if (cache && Date.now() - cacheAt < 3600e3) return cache;
  try {
    const r = await fetch(SITE + 'data.json', { headers: { 'user-agent': 'miles-toolbox-mcp' } });
    if (r.ok){ cache = await r.json(); cacheAt = Date.now(); return cache; }
  } catch { /* 離線或被擋：用隨附副本 */ }
  // Worker 版沒有隨附副本：抓不到就明講，別讓工具噴出看不懂的 undefined 錯誤
  if (!bundled || !bundled.alaska_starlux)
    throw new Error(`暫時取不到資料（${SITE}data.json）。請稍後再試；若持續失敗，代表網站部署有問題。`);
  cache = bundled; cacheAt = Date.now();
  return cache;
}

const R = 3958.7613, rad = d => d * Math.PI / 180;
export const gc = (a, b) => Math.round(2 * R * Math.asin(Math.sqrt(
  Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
  Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2)));
const n = v => v == null ? '—' : v.toLocaleString('en-US');
const CAB = { eco:'經濟', pey:'豪華經濟', biz:'商務', fst:'頭等' };

/* 兌換表取值：華航新制回三段陣列，其餘回單一數字 */
function chartCell(D, program, zoneKey, cab, { ciEra = 'new' } = {}){
  const d = D.award_charts[program];
  if (!d) return null;
  const useOld = program === 'CI' && ciEra === 'old';
  const key = useOld ? ({ asia1:'asia', asia2:'asia', asia3:'asia', ocean:'long', na:'long', eu:'long', nyc:'long' }[zoneKey] || zoneKey) : zoneKey;
  const z = (useOld ? d.oldZones : d.zones).find(z => z.key === key);
  const c = z?.[cab];
  if (!c) return null;
  return { zone: z.zone, sub: z.sub, tiers: c.t || null, value: c.t ? null : c.rt, approx: !!c.approx };
}

function findDest(D, code){
  const c = String(code || '').toUpperCase();
  for (const [group, list] of Object.entries(D.compare_destinations))
    for (const [k, city, av] of list) if (k === c) return { code:k, city, group, av };
  return null;
}
const cxCoord = (D, code) => {
  for (const list of Object.values(D.cathay.airports))
    for (const [k, city, lat, lon] of list) if (k === code) return { code:k, city, lat, lon };
  return null;
};


/* ── 長榮無限萬哩遊：兌換表與票規引擎（與網站 index.html 同一套邏輯） ── */
const evAp = (D, code) => D.eva.airports.find(x => x.code === String(code || '').toUpperCase());
function evSaPrice(D, a, b, cab){
  const Z = D.eva.star_alliance_zones;
  const ia = Z.indexOf(a), ib = Z.indexOf(b);
  if (ia < 0 || ib < 0) return 0;
  const r = Math.min(ia, ib), c = Math.max(ia, ib) - 1;
  return c < 0 ? 0 : Math.round((D.eva.star_alliance_chart[cab]?.[r]?.[c] || 0) * 1000);
}
function evOwnRegion(ap){
  if (['nam','hicam','sam'].includes(ap.sa_zone)) return 'AM';
  if (ap.sa_zone === 'swp') return 'OC';
  if (ap.sa_zone === 'eur') return 'EU';
  if (['tw','hkmo','cn','nasia','sea','csa'].includes(ap.sa_zone)) return 'AS';
  return null;
}
function evOwnSub(ap){
  if (ap.sa_zone === 'tw') return 'TW';
  if (ap.sa_zone === 'hkmo' || ap.sa_zone === 'cn') return 'CN';
  if (ap.sa_zone === 'nasia') return 'NEA';
  if (ap.sa_zone === 'sea' || ap.code === 'DEL') return 'SEA';
  return evOwnRegion(ap);
}
function evOwnBucket(a, b){
  const ra = evOwnRegion(a), rb = evOwnRegion(b);
  if (!ra || !rb) return null;
  const pair = [ra, rb].sort().join('-');
  if (pair === 'AS-AS'){
    const s = [evOwnSub(a), evOwnSub(b)].sort().join('-');
    if (s === 'CN-TW' && a.sa_zone !== 'cn' && b.sa_zone !== 'cn') return 'hkmo';
    return 'asia';
  }
  if (pair === 'AS-OC') return 'ocean';
  if (pair === 'AS-EU') return 'eur';
  if (pair === 'AM-AS') return (a.eva_own_zone === 'ame' || b.eva_own_zone === 'ame') ? 'ame' : 'amw';
  return null;
}
const evDist = A => { let d = 0; for (let i = 0; i + 1 < A.length; i++) d += gc(A[i], A[i+1]); return d; };
function evTax(D, A, cab){
  const prem = cab && cab !== 'eco';
  let sum = 0; const rows = [];
  for (let i = 0; i + 1 < A.length; i++){
    const ap = A[i], usd = (prem && ap.departure_tax_premium_usd) || ap.departure_tax_usd;
    if (usd){ sum += usd; rows.push(`${ap.code} US$${usd}`); }
  }
  const yr = A[0].country === 'HK' ? 0 : D.eva.fees.yr;
  return { usd: sum + yr, yr, rows };
}
/* pts: [{code, stop}]，第 0 筆為出發地 */
function evEval(D, pts, cab, chart){
  const A = pts.map(p => evAp(D, p.code));
  if (A.some(x => !x)) return { ok:false, bad:['行程中有查不到的機場代碼'], miles:0 };
  const org = A[0], bad = [], warn = [];
  const rt = A[0].code === A[A.length - 1].code;
  const priceOf = (x, y) => chart === 'own'
    ? (() => { const b = evOwnBucket(x, y); return b ? D.eva.own_zone_rank.indexOf(b) : -1; })()
    : evSaPrice(D, x.sa_zone, y.sa_zone, cab);

  let ti = -1, best = chart === 'own' ? -1 : 0, td = -1;
  A.forEach((ap, i) => {
    if (!i || (rt && i === A.length - 1)) return;
    const v = priceOf(org, ap), d = gc(org, ap);
    if (v > best || (v === best && v > (chart === 'own' ? -1 : 0) && d > td)){ best = v; ti = i; td = d; }
  });
  if (ti < 0) return { ok:false, bad:['行程未離開出發地所在區域，兌換表沒有適用的格'], miles:0 };
  const turn = A[ti];

  let miles = 0, bucket = null;
  if (chart === 'own'){
    for (let i = 0; i + 1 < A.length; i++){
      const b = evOwnBucket(A[i], A[i+1]);
      if (!b){ bad.push(`${A[i].code}→${A[i+1].code} 不在長榮自家兌換表的任何一格`); continue; }
      if (!bucket || D.eva.own_zone_rank.indexOf(b) > D.eva.own_zone_rank.indexOf(bucket)) bucket = b;
    }
    const noBR = [...new Set(A.filter(x => !x.eva_operated).map(x => x.code))];
    if (noBR.length) bad.push(`自家票僅限長榮／立榮航班，${noBR.join('、')} 沒有長榮航班`);
    if (!bucket) return { ok:false, bad, miles:0 };
    miles = D.eva.own_chart[bucket][cab];
    if (miles == null){ bad.push(`${D.eva.own_chart[bucket].name}沒有此艙等的兌換`); miles = 0; }
    else if (!rt) miles = miles / 2;
  } else {
    miles = rt ? best : Math.round(best / 2);
    const cap = rt ? miles : miles * 2;
    for (let i = 0; i + 1 < A.length; i++){
      const v = evSaPrice(D, A[i].sa_zone, A[i+1].sa_zone, cab);
      if (v > cap) bad.push(`${A[i].code}→${A[i+1].code} 需 ${n(v)} 哩，高於「出發地→折返點」基準 ${n(cap)} 哩（2025/9/1 新制①）`);
    }
    const B = D.eva.cross_region_blocs, BN = { AM:'美洲', EA:'歐洲／非洲／中東', AP:'亞洲／西南太平洋' };
    if (B[org.sa_zone] !== B[turn.sa_zone]){
      const ban = ['AM','EA','AP'].find(g => g !== B[org.sa_zone] && g !== B[turn.sa_zone]);
      const hit = [...new Set(A.filter(x => B[x.sa_zone] === ban).map(x => x.code))];
      if (hit.length) bad.push(`跨區禁行（新制③）：${BN[B[org.sa_zone]]} ↔ ${BN[B[turn.sa_zone]]} 不得經過${BN[ban]}（${hit.join('、')}）`);
    }
  }

  const mid = pts.map((p, i) => ({ p, i })).filter(({ i }) => i > 0 && i < pts.length - 1 && i !== ti);
  const stops = mid.filter(({ p }) => p.stop).map(({ i }) => A[i]);
  const trans = mid.filter(({ p }) => !p.stop).map(({ i }) => A[i]);
  const segs = A.length - 1;
  if (chart === 'own'){
    const longHaul = ['ocean','amw','ame','eur'].includes(bucket);
    if (rt && !longHaul && stops.length) bad.push('短程線（亞洲區域間、台灣＝港澳）來回票不可停留，只能轉機');
    if (rt && longHaul && stops.length > 1) bad.push(`長程線來回票最多 1 個停留點，此行程有 ${stops.length} 個`);
    if (!rt && stops.length) bad.push('單程票可以轉機但不可停留');
    if (org.sa_zone === 'tw' && rt && trans.some(t => t.sa_zone === 'tw'))
      bad.push('台灣出發的來回行程不得以台灣為轉機點');
  } else {
    if (rt && stops.length > 2) bad.push(`來回票最多 2 個停留點，此行程有 ${stops.length} 個`);
    if (rt && segs > 6) bad.push(`來回票最多 6 個航段，此行程有 ${segs} 段`);
    if (!rt && stops.length) bad.push('單程票不可中停（可以轉機）');
    if (!rt && segs > 3) bad.push(`單程票最多 3 個航段，此行程有 ${segs} 段`);
    for (const t of trans)
      if ([org, turn].some(x => x.city_key === t.city_key))
        bad.push(`轉機點 ${t.code} 與出發地／目的地／折返點同城市（新制②）`);
    if (stops.length) warn.push('含中途停留的星盟票不能線上開票，須透過長榮客服');
  }
  for (const s of stops){
    if (s.country === org.country) bad.push(`停留點 ${s.code} 與出發地同國（${org.country_name}）`);
    else if (s.country === turn.country) bad.push(`停留點 ${s.code} 與目的地同國（${turn.country_name}）`);
  }
  return { ok:!bad.length, bad, warn, miles, bucket, turn, stops, trans, segs, rt, A,
    dist: evDist(A), tax: evTax(D, A, cab) };
}
const evParse = s => String(s || '').split(/[>>,→]+/).map(x => x.trim()).filter(Boolean)
  .map(x => ({ code: x.replace(/\*+$/, '').toUpperCase(), stop: /\*$/.test(x) }));
const evChain = pts => pts.map(p => p.code + (p.stop ? '（停留）' : '')).join(' → ');

export const TOOLS = [
  {
    name: 'stopover_combos',
    description: '阿拉斯加哩程開星宇：給一個外站出發地，算出所有可「免費中停台灣 14 天」再飛第三國的組合，含兩段大圓距離與所需哩程（≤1,500 哩為甜蜜區）。這是本站的核心計算。',
    inputSchema: { type:'object', properties:{
      origin: { type:'string', description:'出發地 IATA 代碼，如 HKG、MFM、NRT' },
      zone: { type:'string', enum:['sweet','edge','all'], description:'sweet=僅 ≤1,500 哩；edge=含 1,500–1,600 壓線；all=全部（預設 sweet）' },
    }, required:['origin'] },
    run: async (D, a) => {
      const A = D.alaska_starlux, code = String(a.origin || '').toUpperCase();
      const o = A.airports.find(x => x.code === code);
      if (!o) return `找不到航點 ${code}。星宇航點：` + A.airports.map(x => x.code).join('、');
      if (o.scope === 'longhaul') return `${code} ${o.city} 為長程線，不適用此中停規則（適用另一張兌換表）。`;
      const want = a.zone || 'sweet';
      const rows = [];
      for (const hubCode of o.hubs || []){
        const hub = A.hubs[hubCode];
        const leg1 = gc(o, hub);
        for (const d of A.airports){
          if (d.code === o.code || !d.hubs?.includes(hubCode) || d.scope !== 'asia') continue;
          if (d.country === o.country) continue;          // 出發、目的須不同國家／地區
          const total = leg1 + gc(hub, d);
          const zone = total <= 1500 ? 'sweet' : total <= 1600 ? 'edge' : 'over';
          if (want === 'sweet' && zone !== 'sweet') continue;
          if (want === 'edge' && zone === 'over') continue;
          const p = total <= 1500 ? A.price.sweet : A.price.high;
          rows.push({ hub:hubCode, dest:d, total, zone, eco:p.eco, biz:p.biz });
        }
      }
      if (!rows.length) return `${code} ${o.city} 沒有符合條件的組合（zone=${want}）。`;
      rows.sort((x, y) => x.total - y.total);
      const lines = rows.map(r =>
        `- ${code} → ${r.hub} → ${r.dest.code} ${r.dest.city}：${n(r.total)} 哩｜經濟 ${n(r.eco)}／商務 ${n(r.biz)}${r.zone === 'edge' ? '（壓線區，以官網查價為準）' : ''}${r.dest.seasonal ? '（季節性航班）' : ''}`);
      return `## ${o.city}（${code}）出發・可中停台灣 ${A.stopover_days} 天的組合（${rows.length} 組）\n\n`
        + lines.join('\n')
        + `\n\n規則：兩段皆星宇；中停台北/台中最長 ${A.stopover_days} 天；出發地與目的地須不同國家／地區；雙向皆可開。哩程為單程。`;
    },
  },
  {
    name: 'award_price',
    description: '查某家計畫飛某目的地要多少哩程（華航／長榮／星宇）。華航會回傳 2026/9/16 新制的三段式動態哩程（充足／有限／稀少），並可查現行制。',
    inputSchema: { type:'object', properties:{
      program: { type:'string', enum:['CI','BR','JX'], description:'CI 華航／BR 長榮／JX 星宇' },
      destination: { type:'string', description:'目的地 IATA 代碼，如 NRT、LAX、BKK' },
      trip: { type:'string', enum:['rt','ow'], description:'rt 來回（預設）／ow 單程' },
      ci_era: { type:'string', enum:['new','old'], description:'華航制度：new 新制 2026/9/16 起（預設）／old 現行' },
    }, required:['program','destination'] },
    run: async (D, a) => {
      const prog = String(a.program || '').toUpperCase();
      const dest = findDest(D, a.destination);
      if (!dest) return `目的地 ${a.destination} 不在比較清單中。可用：` +
        Object.values(D.compare_destinations).flat().map(x => x[0]).join('、');
      const key = dest.av[prog.toLowerCase()];
      if (!key) return `${D.award_charts[prog]?.name || prog} 未飛航 ${dest.code} ${dest.city}（或不適用）。`;
      const f = a.trip === 'ow' ? 0.5 : 1;
      const label = a.trip === 'ow' ? '單程' : '來回';
      const era = a.ci_era || 'new';
      const out = [`## ${D.award_charts[prog].name}：台灣 ⇄ ${dest.city}（${dest.code}）・${label}`, ''];
      for (const cab of ['eco','pey','biz']){
        const c = chartCell(D, prog, key, cab, { ciEra: era });
        if (!c){ out.push(`- ${CAB[cab]}：—`); continue; }
        if (c.tiers) out.push(`- ${CAB[cab]}：充足 ${n(Math.round(c.tiers[0]*f))}／有限 ${n(Math.round(c.tiers[1]*f))}／稀少-候補 ${n(Math.round(c.tiers[2]*f))} 哩`);
        else out.push(`- ${CAB[cab]}：${c.approx ? '約 ' : ''}${n(Math.round(c.value*f))} 哩`);
      }
      const z = chartCell(D, prog, key, 'eco', { ciEra: era });
      out.push('', `區域：${z?.zone || key}${z?.sub ? `（${z.sub}）` : ''}`);
      if (prog === 'CI' && era === 'new')
        out.push('', '華航 2026/9/16 起依酬賓機位供需分三級，以**開票日**為準；分公司代辦一律按「稀少/候補」扣哩，官網自助才看得到充足價。');
      out.push('', D.note);
      return out.join('\n');
    },
  },
  {
    name: 'compare_programs',
    description: '同一個目的地，比較華航／長榮／星宇／國泰／阿拉斯加×星宇各要多少哩程，可加上哩程取得成本換算成台幣比較「真正划算」的一家。',
    inputSchema: { type:'object', properties:{
      destination: { type:'string', description:'目的地 IATA 代碼' },
      trip: { type:'string', enum:['rt','ow'], description:'rt 來回（預設）／ow 單程' },
      cost_mode: { type:'boolean', description:'true 時另以每哩取得成本估算台幣' },
    }, required:['destination'] },
    run: async (D, a) => {
      const dest = findDest(D, a.destination);
      if (!dest) return `目的地 ${a.destination} 不在清單中。`;
      const f = a.trip === 'ow' ? 0.5 : 1, x2 = a.trip === 'ow' ? 1 : 2;
      const rates = D.mile_cost_ntd, rows = [];
      for (const prog of ['CI','BR','JX']){
        const key = dest.av[prog.toLowerCase()];
        const cells = ['eco','pey','biz'].map(cab => {
          const c = key ? chartCell(D, prog, key, cab) : null;
          if (!c) return null;
          const lo = Math.round((c.tiers ? c.tiers[0] : c.value) * f);
          const hi = Math.round((c.tiers ? c.tiers[2] : c.value) * f);
          return { lo, hi, dyn: !!c.tiers };
        });
        rows.push({ id:prog, name:D.award_charts[prog].name, cells });
      }
      // 國泰：台灣出發經香港，按總距離查表
      const hk = cxCoord(D, 'HKG'), tp = cxCoord(D, 'TPE'), to = cxCoord(D, dest.code);
      if (to && hk && tp){
        const dist = dest.code === 'HKG' ? gc(tp, hk) : gc(tp, hk) + gc(hk, to);
        const band = D.cathay.chart.find(b => dist <= b.max);
        const cx = c => !c ? null : { lo:Math.round((c.lo ?? c.v) * x2), hi:Math.round((c.hi ?? c.v) * x2), dyn:false };
        rows.push({ id:'CX', name:`國泰（經香港・${n(dist)} 哩・${band.name}）`, cells:['eco','pey','biz'].map(k => cx(band[k])) });
      }
      // 阿拉斯加 × 星宇（亞洲區）
      if (dest.av.jx === 'asia'){
        const A = D.alaska_starlux, d1 = gc(A.hubs.TPE, cxCoord(D, dest.code) || {});
        const p = d1 <= 1500 ? A.price.sweet : A.price.high;
        rows.push({ id:'AS', name:'阿拉斯加 × 星宇（可另加免費中停台灣 14 天）',
          cells:[{ lo:p.eco*x2, hi:p.eco*x2 }, null, { lo:p.biz*x2, hi:p.biz*x2 }] });
      }
      const out = [`## 台灣 ⇄ ${dest.city}（${dest.code}）・${a.trip === 'ow' ? '單程' : '來回'}所需哩程`, '',
        '| 計畫 | 經濟 | 豪經 | 商務 |', '|---|---|---|---|'];
      const fmtc = (r, c) => !c ? '—' : (c.lo === c.hi ? n(c.lo) : `${n(c.lo)}–${n(c.hi)}`) +
        (a.cost_mode ? `（≈NT$${n(Math.round(c.lo * rates[r.id] / 100) * 100)}）` : '');
      for (const r of rows) out.push(`| ${r.name} | ${fmtc(r, r.cells[0])} | ${fmtc(r, r.cells[1])} | ${fmtc(r, r.cells[2])} |`);
      // 各艙等最省
      out.push('');
      for (const [i, cab] of ['eco','pey','biz'].entries()){
        const cand = rows.filter(r => r.cells[i]).map(r => ({ r, v: a.cost_mode ? r.cells[i].lo * rates[r.id] : r.cells[i].lo }));
        if (!cand.length) continue;
        const best = cand.sort((p, q) => p.v - q.v)[0];
        out.push(`- ${CAB[cab]}最省：**${best.r.name}**（${n(best.r.cells[i].lo)} 哩${a.cost_mode ? `≈NT$${n(Math.round(best.v))}` : ''}）`);
      }
      out.push('', '華航為新制動態，區間即「充足–稀少/候補」。' +
        (a.cost_mode ? `取得成本（每哩 NT$）：${Object.entries(rates).map(([k, v]) => k + ' ' + v).join('、')}。` : '哩程數少不等於划算，可加 cost_mode 以台幣比較。'));
      return out.join('\n');
    },
  },
  {
    name: 'cathay_price',
    description: '國泰亞洲萬里通按「總距離」計價：給任兩個機場算大圓距離、落在哪個距離帶、各艙等單程里數。台灣出發須經香港轉機（自動加計）。',
    inputSchema: { type:'object', properties:{
      from: { type:'string', description:'出發地 IATA' }, to: { type:'string', description:'目的地 IATA' },
    }, required:['from','to'] },
    run: async (D, a) => {
      const f = cxCoord(D, String(a.from).toUpperCase()), t = cxCoord(D, String(a.to).toUpperCase());
      if (!f || !t) return `找不到機場（可用：${Object.values(D.cathay.airports).flat().map(x => x[0]).join('、')}）`;
      const viaHK = !['HKG'].includes(f.code) && !['HKG'].includes(t.code);
      const hk = cxCoord(D, 'HKG');
      const dist = viaHK ? gc(f, hk) + gc(hk, t) : gc(f, t);
      const band = D.cathay.chart.find(b => dist <= b.max);
      const cell = c => !c ? '—' : (c.v != null ? `${c.approx ? '約 ' : ''}${n(c.v)}` : `${n(c.lo)}–${n(c.hi)}`);
      return `## 國泰：${f.city}（${f.code}）→ ${t.city}（${t.code}）\n\n`
        + `總距離 **${n(dist)} 哩**${viaHK ? `（${f.code}–HKG ${n(gc(f, hk))} ＋ HKG–${t.code} ${n(gc(hk, t))}，須經香港轉機）` : ''}\n`
        + `距離帶：**${band.name}**（上限 ${n(band.max)} 哩）\n\n`
        + `- 經濟：${cell(band.eco)}\n- 豪經：${cell(band.pey)}\n- 商務：${cell(band.biz)}\n- 頭等：${cell(band.fst)}\n\n`
        + `以上為**單程**里數（2026/5/1 新表），來回 ×2。短途依城市類別以區間顯示。`;
    },
  },
  {
    name: 'four_leg_rules',
    description: '三大航「外站出發、經台北折返」四段票（A→TPE→B→TPE→A）的票規與注意事項。',
    inputSchema: { type:'object', properties:{
      airline: { type:'string', enum:['CI','BR','JX'], description:'不指定則回傳三家' },
    } },
    run: async (D, a) => {
      const ids = a.airline ? [String(a.airline).toUpperCase()] : Object.keys(D.four_leg);
      return ids.map(id => {
        const x = D.four_leg[id];
        if (!x) return `找不到 ${id}`;
        return `## ${x.name}（${x.code}）\n\n- 票規：${x.rule}\n${x.extra ? `- 補充：${x.extra}\n` : ''}- 官網：${x.site}`;
      }).join('\n\n') + `\n\n共通：外站開票常比台灣出發便宜、且能多玩台灣；票期一年；日期須依序。`;
    },
  },
  {
    name: 'elite_status',
    description: '華航／長榮／星宇的會籍門檻，可給目前累積數字算出還差多少。',
    inputSchema: { type:'object', properties:{
      program: { type:'string', enum:['CI','BR','JX'] },
      current: { type:'number', description:'目前累積的積分或哩程' },
    } },
    run: async (D, a) => {
      const ids = a.program ? [String(a.program).toUpperCase()] : Object.keys(D.elite);
      const cur = +a.current || 0;
      return ids.map(id => {
        const e = D.elite[id];
        if (!e) return `找不到 ${id}`;
        const tiers = e.tiers.map(t => {
          const gap = t.v - cur;
          return `  - ${t.t}：${t.approx ? '約 ' : ''}${n(t.v)} ${e.unit}${t.extra ? `（${t.extra}）` : ''}` +
            (cur ? (gap <= 0 ? ' ✓ 已達標' : ` — 還差 ${n(gap)}`) : '');
        }).join('\n');
        return `## ${e.name}（單位：${e.unit}）\n${tiers}\n\n${e.note}`;
      }).join('\n\n');
    },
  },
  {
    name: 'latest_fare_scan',
    description: '取得每日自動掃描的外站四段票「同航司」實際票價：A⇄TPE＋TPE⇄B 雙來回組合價 vs 該航司台北直飛來回，看加購外站段的成本。資料為 Google Flights 即時解析結果。',
    inputSchema: { type:'object', properties:{
      cabin: { type:'string', enum:['ECONOMY','BUSINESS'], description:'不指定則兩種都回' },
    } },
    run: async (D, a) => {
      let j;
      try { j = await fetch(SITE + 'fares.json').then(r => r.json()); }
      catch { return '目前取不到掃描結果（fares.json）。'; }
      if (!j.results?.length) return '尚無掃描結果。';
      const want = a.cabin ? String(a.cabin).toUpperCase() : null;
      const out = [`## 四段票甜度掃描（掃描時間 ${String(j.scanned_at).slice(0, 16).replace('T', ' ')} UTC）`, '',
        `日期樣板：外站出發 +60 天、折返點停 7 天、台灣停 30 天。`, ''];
      for (const r of j.results){
        if (want && r.cabin !== want) continue;
        const cab = r.cabin === 'BUSINESS' ? '商務' : '經濟';
        if (r.als){   // 同航司版
          const parts = Object.values(r.als).map(v => v.four
            ? `${v.n} ${v.four.raw}（直飛 ${v.bench.raw}、加購 +NT$${n(Math.round(v.four.price - v.bench.price))}）`
            : `${v.n} 無報價`);
          out.push(`- **${r.an} ⇄ ${r.bn}・${cab}**：` + parts.join('；'));
        } else if (r.four && !r.four.error){
          out.push(`- **${r.an} ⇄ ${r.bn}・${cab}**：${r.four.raw}（直飛 ${r.bench?.raw || '—'}）`);
        }
      }
      out.push('', '「加購」＝比單買該航司台北直飛來回多付的錢，即多換到一張外站⇄台北來回的代價。價格隨時變動，以官網為準。');
      return out.join('\n');
    },
  },
  {
    name: 'eva_check_itinerary',
    description: '長榮無限萬哩遊：驗證一個行程能不能開、要多少哩程、稅費多少。內建 2025/9/1 三條新制（折返點基準、同城轉機禁令、跨區禁行）與自家票的停留規則。',
    inputSchema: { type:'object', properties:{
      itinerary: { type:'string', description:'用 > 串起機場代碼，代碼後加 * 代表停留（過夜以上），不加就是轉機。例：TPE > BKK* > FRA* > IST* > TPE' },
      chart: { type:'string', enum:['own','sa'], description:'own 長榮／立榮自家票；sa 星空聯盟票（預設 sa）' },
      cabin: { type:'string', enum:['eco','pey','biz','fst'], description:'預設 biz（自家票無 fst，星盟票無 pey）' },
    }, required:['itinerary'] },
    run: async (D, a) => {
      const chart = a.chart === 'own' ? 'own' : 'sa';
      const cab = a.cabin || 'biz';
      const pts = evParse(a.itinerary);
      if (pts.length < 2) return '請至少給兩個機場代碼，例如：TPE > BKK* > FRA* > TPE';
      const r = evEval(D, pts, cab, chart);
      const out = [`## ${r.ok ? '✅ 票規允許' : '❌ 這樣開不出來'}　${chart === 'own' ? '長榮自家票' : '星空聯盟票'}・${CAB[cab]}`, '',
        `行程：${evChain(pts)}`, ''];
      if (r.miles) out.push(`- 所需哩程：**${n(r.miles)}**（${r.rt ? '來回' : '單程'}）${r.bucket ? `・適用「${D.eva.own_chart[r.bucket].name}」` : ''}`);
      if (r.turn) out.push(`- 折返點（系統認定）：${r.turn.code} ${r.turn.city}`);
      out.push(`- 停留 ${r.stops?.length || 0} 個・轉機 ${r.trans?.length || 0} 個・共 ${r.segs} 個航段`);
      out.push(`- 實際飛行：${n(r.dist)} 哩${r.miles ? `・效益 ${Math.round(r.dist / r.miles * 10000)} 哩/萬哩程` : ''}`);
      if (r.tax) out.push(`- 稅費估算：約 US$${n(r.tax.usd)}（${r.tax.rows.join('、')}${r.tax.yr ? `、訂位服務費 YR US$${r.tax.yr}` : '、香港出發免收 YR'}）`);
      if (r.bad?.length) out.push('', '**不合規：**', ...r.bad.map(b => `- ${b}`));
      if (r.warn?.length) out.push('', '**注意：**', ...r.warn.map(b => `- ${b}`));
      if (r.ok && r.stops?.length){
        const sep = [...r.stops, r.turn].reduce((s, p) => s + (chart === 'own'
          ? (evEval(D, [{code:r.A[0].code}, {code:p.code, stop:true}, {code:r.A[0].code}], cab, chart).miles || 0)
          : evSaPrice(D, r.A[0].sa_zone, p.sa_zone, cab)), 0);
        out.push('', `一張張分開換要 ${n(sep)} 哩，這樣開只要 ${n(r.miles)} 哩，**省 ${n(Math.max(0, sep - r.miles))} 哩**。`);
      }
      out.push('', '哩程與票規為整理值，開票前以長榮官網／客服為準。本工具只判斷票規是否允許，實際能否開票還要看酬賓機位與航線。');
      return out.join('\n');
    },
  },
  {
    name: 'eva_free_stopovers',
    description: '長榮無限萬哩遊的核心玩法：給起點與目的地，列出「加了不用多花半哩」的免費中停城市，以及「只多一點點哩程就能再多一段」的加碼選項，含多飛距離、繞路比與稅費估算。',
    inputSchema: { type:'object', properties:{
      origin: { type:'string', description:'出發地 IATA 代碼，如 TPE、BKK、HKG' },
      destination: { type:'string', description:'目的地（折返點）IATA 代碼，如 LHR、LAX、FRA' },
      chart: { type:'string', enum:['own','sa'], description:'own 長榮／立榮自家票；sa 星空聯盟票（預設 sa）' },
      cabin: { type:'string', enum:['eco','pey','biz','fst'], description:'預設 biz' },
      hubs_only: { type:'boolean', description:'中停點只看星盟樞紐（預設 true，比較訂得到）' },
      max_detour: { type:'number', description:'繞路上限（起點→中停→目的地 相對直飛的距離比），預設 1.5' },
    }, required:['origin','destination'] },
    run: async (D, a) => {
      const chart = a.chart === 'own' ? 'own' : 'sa', cab = a.cabin || 'biz';
      const org = evAp(D, a.origin), dst = evAp(D, a.destination);
      if (!org) return `找不到出發地 ${a.origin}。`;
      if (!dst) return `找不到目的地 ${a.destination}。`;
      const cap = a.max_detour || 1.5, hubsOnly = a.hubs_only !== false;
      const base = evEval(D, [{code:org.code}, {code:dst.code, stop:true}, {code:org.code}], cab, chart);
      if (!base.miles) return `${org.code} ⇄ ${dst.code} 在這張兌換表上換不了：` + (base.bad || []).join('；');
      const direct = gc(org, dst), rows = [];
      for (const s of D.eva.airports){
        if (s.code === org.code || s.code === dst.code) continue;
        if (s.city_key === org.city_key || s.city_key === dst.city_key) continue;
        if (chart === 'own' && !s.eva_operated) continue;
        if (chart === 'sa' && hubsOnly && !s.star_alliance_hub) continue;
        const detour = direct ? (gc(org, s) + gc(s, dst)) / direct : 1;
        if (detour > cap) continue;
        let hit = null;
        for (const dir of ['out','in']){
          const pts = dir === 'out'
            ? [{code:org.code}, {code:s.code, stop:true}, {code:dst.code, stop:true}, {code:org.code}]
            : [{code:org.code}, {code:dst.code, stop:true}, {code:s.code, stop:true}, {code:org.code}];
          const r = evEval(D, pts, cab, chart);
          if (r.ok && r.miles && (!hit || r.dist > hit.r.dist)) hit = { r, dir };
        }
        if (!hit) continue;
        const alone = chart === 'own'
          ? (evEval(D, [{code:org.code}, {code:s.code, stop:true}, {code:org.code}], cab, chart).miles || 0)
          : evSaPrice(D, org.sa_zone, s.sa_zone, cab);
        rows.push({ s, dir:hit.dir, delta:hit.r.miles - base.miles, miles:hit.r.miles, alone,
          add:hit.r.dist - base.dist, detour, tax:hit.r.tax.usd });
      }
      const free = rows.filter(r => !r.delta).sort((x, y) => y.add - x.add);
      const up = rows.filter(r => r.delta > 0).sort((x, y) => x.delta - y.delta || y.add - x.add);
      const line = r => `- **${r.s.code} ${r.s.city}**（${r.s.country_name}・${r.dir === 'out' ? '去程' : '回程'}停留）：`
        + `${r.delta ? `＋${n(r.delta)} 哩` : '**＋0 哩**'}，多飛 ${n(r.add)} 哩・繞路 ×${r.detour.toFixed(2)}`
        + `・單買此點要 ${n(r.alone)} 哩・稅費約 US$${n(r.tax)}`;
      const out = [`## ${org.code} ${org.city} ⇄ ${dst.code} ${dst.city}・${chart === 'own' ? '長榮自家票' : '星盟票'}・${CAB[cab]}`, '',
        `基準（不加中停）：**${n(base.miles)} 哩**來回，飛行 ${n(base.dist)} 哩，稅費約 US$${n(base.tax.usd)}`, '',
        `### 免費中停（${free.length}）— 所需哩程完全一樣`, ''];
      out.push(free.length ? free.map(line).join('\n') : '（這條路線沒有合規又順路的免費中停點）');
      out.push('', `### 小加碼（${up.length}）— 多花一點就能再多一個城市`, '');
      out.push(up.length ? up.slice(0, 15).map(line).join('\n') : '（沒有可加碼的選項）');
      out.push('', chart === 'sa'
        ? '為什麼免費：星盟票以「出發地→折返點」計價，任何所需哩程不超過這個基準的城市都能停留而不加價（2025/9/1 新制①）。含停留的星盟票須透過客服開票。'
        : '為什麼免費：長榮自家票「三個航段以上取最高的那一格」，中停點落在較便宜的格子裡就不影響總價。長程線來回最多停留 1 次。');
      out.push('', '本工具只判斷票規是否允許；實際能不能開，仍要看酬賓機位與各星盟成員的航線。');
      return out.join('\n');
    },
  },
  {
    name: 'eva_explore',
    description: '長榮無限萬哩遊：手上有 N 哩、從某地出發，能換到哪些目的地？依「飛行哩程 ÷ 所需哩程」的效益排序，並附各目的地的免費中停選項與稅費估算。',
    inputSchema: { type:'object', properties:{
      origin: { type:'string', description:'出發地 IATA 代碼（預設 TPE）' },
      miles: { type:'number', description:'手上的哩程；不填就列出全部' },
      chart: { type:'string', enum:['own','sa'], description:'own 自家票／sa 星盟票（預設 sa）' },
      cabin: { type:'string', enum:['eco','pey','biz','fst'], description:'預設 biz' },
      limit: { type:'number', description:'回傳幾筆（預設 15）' },
    } },
    run: async (D, a) => {
      const chart = a.chart === 'own' ? 'own' : 'sa', cab = a.cabin || 'biz';
      const org = evAp(D, a.origin || 'TPE');
      if (!org) return `找不到出發地 ${a.origin}。`;
      const budget = +a.miles || 0, rows = [];
      for (const d of D.eva.airports){
        if (d.code === org.code || d.city_key === org.city_key) continue;
        if (chart === 'own' && !d.eva_operated) continue;
        const r = evEval(D, [{code:org.code}, {code:d.code, stop:true}, {code:org.code}], cab, chart);
        if (!r.ok || !r.miles || (budget && r.miles > budget)) continue;
        rows.push({ d, miles:r.miles, dist:r.dist, tax:r.tax.usd, eff:Math.round(r.dist / r.miles * 10000) });
      }
      if (!rows.length) return `${org.code} 出發、${CAB[cab]}${budget ? `、${n(budget)} 哩以內` : ''}沒有可換的目的地。`;
      rows.sort((x, y) => y.eff - x.eff);
      const lim = Math.max(1, Math.min(60, a.limit || 15));
      const out = [`## ${org.code} ${org.city} 出發・${chart === 'own' ? '長榮自家票' : '星盟票'}・${CAB[cab]}`
        + `${budget ? `・${n(budget)} 哩以內` : ''}（共 ${rows.length} 個，依效益排序取前 ${Math.min(lim, rows.length)}）`, '',
        '| 目的地 | 區域 | 來回哩程 | 來回飛行 | 效益（哩/萬哩程） | 稅費估算 |', '|---|---|---|---|---|---|'];
      for (const r of rows.slice(0, lim))
        out.push(`| ${r.d.code} ${r.d.city} | ${r.d.sa_zone_name} | ${n(r.miles)} | ${n(r.dist)} 哩 | ${r.eff} | US$${n(r.tax)} |`);
      out.push('', '效益＝來回實際飛行哩程 ÷ 所需哩程 × 10,000，越大越划算。用 `eva_free_stopovers` 查每個目的地能免費加哪些中停城市。');
      out.push('', '稅費估算含訂位服務費 YR US$33／張（香港出發免收），不含燃油附加費；為整理值，以開票為準。');
      return out.join('\n');
    },
  },
  {
    name: 'list_airports',
    description: '列出星宇航點（含距各台灣樞紐的大圓距離、是否參與中停配對、季節性等），可用關鍵字或國家篩選。',
    inputSchema: { type:'object', properties:{
      query: { type:'string', description:'IATA、城市或國家代碼（如 JP、越南），留空列全部' },
    } },
    run: async (D, a) => {
      const q = String(a.query || '').toUpperCase();
      const list = D.alaska_starlux.airports.filter(x => !q ||
        x.code.includes(q) || x.city.toUpperCase().includes(q) || (x.country || '').includes(q) ||
        (x.country_name || '').includes(a.query) || x.city.includes(a.query));
      if (!list.length) return `查無符合「${a.query}」的航點。`;
      const hubs = Object.values(D.alaska_starlux.hubs || {});
      const head = `| IATA | 城市 | 國家 | ${hubs.map(h => `距${h.code}`).join(' | ')} | 說明 |\n` +
        `|---|---|---|${hubs.map(() => '---|').join('')}---|`;
      const rows = list.map(x => `| ${x.code} | ${x.city} | ${x.country_name || x.country} | ` +
        hubs.map(h => x.hub_miles?.[h.code] ? n(x.hub_miles[h.code]) : '—').join(' | ') + ` | ${[
          x.scope === 'longhaul' ? '長程線' : '', x.scope === 'future' ? '未開航' : '',
          x.seasonal ? '季節性' : '', x.note || ''].filter(Boolean).join('；') || '—'} |`);
      const plan = hubs.filter(h => h.planned).map(h => `${h.code} ${h.name} 為規劃中據點（${h.planned}），` +
        (h.plannedRoutes?.length
          ? `首波傳聞班表：` + h.plannedRoutes.map(r => `${h.code}⇄${r.to} ${r.name}（去 ${r.out}／回 ${r.back}／${r.freq}）`).join('、') + '；星宇尚未官宣。'
          : '航線尚未開賣。'));
      return [head, ...rows].join('\n') + (plan.length ? `\n\n> ${plan.join(' ')}` : '');
    },
  },
];

/* JSON-RPC 分派（stdio 與 Worker 共用） */
export async function handle(msg, bundled){
  const { id, method, params } = msg;
  const ok = result => ({ jsonrpc:'2.0', id, result });
  if (method === 'initialize') return ok({
    protocolVersion: params?.protocolVersion === '2024-11-05' ? '2024-11-05' : '2025-06-18',
    capabilities: { tools: {} },
    serverInfo: { name:'miles-toolbox', version:'1.0.0' },
    instructions: '台灣出發的哩程／現金票攻略資料與計算工具。哩程為整理值，開票前以航空公司官網為準。',
  });
  if (method === 'ping') return ok({});
  if (method === 'tools/list') return ok({ tools: TOOLS.map(({ name, description, inputSchema }) =>
    ({ name, description, inputSchema })) });
  if (method === 'tools/call'){
    const t = TOOLS.find(t => t.name === params?.name);
    if (!t) return { jsonrpc:'2.0', id, error:{ code:-32602, message:`未知的工具：${params?.name}` } };
    try {
      const D = await loadData(bundled);
      const text = await t.run(D, params.arguments || {});
      return ok({ content: [{ type:'text', text }] });
    } catch (e){
      return ok({ content: [{ type:'text', text: `工具執行失敗：${e.message}` }], isError: true });
    }
  }
  if (method?.startsWith('notifications/')) return null;   // 通知不需回覆
  return { jsonrpc:'2.0', id, error:{ code:-32601, message:`不支援的方法：${method}` } };
}

/* 從 index.html 抽出資料常數，產生給 AI／爬蟲讀的靜態知識檔。
   單一事實來源：頁面改資料，知識檔跟著變，不會脫節。
   產出：data.json（機器可讀）、llms-full.txt（完整知識）、llms.txt（索引）、robots.txt */
import { readFileSync, writeFileSync } from 'node:fs';

const SITE = 'https://chung223.github.io/as-jx/';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

/* 以括號配對取出 `const NAME = {...};` 的字面量（略過字串與註解內的括號） */
function literal(name){
  const m = new RegExp(`const\\s+${name}\\s*=\\s*`).exec(html);
  if (!m) throw new Error('找不到常數 ' + name);
  let i = m.index + m[0].length;
  const open = html[i];
  if (open !== '{' && open !== '[') throw new Error(name + ' 不是物件／陣列字面量');
  const close = open === '{' ? '}' : ']';
  let depth = 0, q = null, esc = false;
  for (let j = i; j < html.length; j++){
    const c = html[j], c2 = html.slice(j, j + 2);
    if (q){
      if (esc){ esc = false; continue; }
      if (c === '\\'){ esc = true; continue; }
      if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`'){ q = c; continue; }
    if (c2 === '//'){ j = html.indexOf('\n', j); continue; }
    if (c2 === '/*'){ j = html.indexOf('*/', j) + 1; continue; }
    if (c === open) depth++;
    else if (c === close && --depth === 0)
      return new Function('return (' + html.slice(i, j + 1) + ')')();
  }
  throw new Error(name + ' 括號未閉合');
}

const D = Object.fromEntries(['HUBS','AIRPORTS','COUNTRY','PRICE','FL_AIRLINES','FL_SPOTS','MILE_DATA',
  'CI_TIER_NAME','BR_ZONE_NAME','BR_ZONE_APTS','BR_ASIA_X','CX_AIRPORTS','CX_CHART','NH_PRICE',
  'NH_DOM_BANDS','CMP_DESTS','CMP_RATE_DEF','ELITE','PROGRAMS',
  'EV_Z','EV_ZN','EV_CHART','EV_BLOC','EV_OWN','EV_OWN_RANK','EV_RTW','EV_FEES',
  'EV_UP_PEY','EV_UP_NOPEY','EV_UP_SA','EV_RULES','EV_CC','EV_AP_RAW'].map(n => [n, literal(n)]));

/* 長榮星盟兌換表：上三角矩陣的取值（單位千哩、來回） */
const evPrice = (a, b, cab) => {
  const ia = D.EV_Z.indexOf(a), ib = D.EV_Z.indexOf(b);
  if (ia < 0 || ib < 0) return 0;
  const r = Math.min(ia, ib), c = Math.max(ia, ib) - 1;
  return c < 0 ? 0 : Math.round((D.EV_CHART[cab]?.[r]?.[c] || 0) * 1000);
};
const EV_AP = D.EV_AP_RAW.map(([code, city, ck, cc, sa, br, lat, lon, tax, fl, tnote, tprem]) =>
  ({ code, city, city_key: ck || code, country: cc, country_name: D.EV_CC[cc] || cc,
     sa_zone: sa, sa_zone_name: D.EV_ZN[sa], eva_own_zone: br || null, lat, lon,
     departure_tax_usd: tax, departure_tax_premium_usd: tprem || null, tax_note: tnote || '',
     eva_operated: !!(fl & 1), star_alliance_hub: !!(fl & 2) }));

const n = v => v == null ? '—' : v.toLocaleString('en-US');
const R = 3958.7613, rad = d => d * Math.PI / 180;
const gc = (a, b) => Math.round(2 * R * Math.asin(Math.sqrt(
  Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
  Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2)));

const out = [];
const P = s => out.push(s);
const today = new Date().toISOString().slice(0, 10);

P(`# 哩程玩家工具箱 — 完整知識庫`);
P(``);
P(`> 台灣出發的哩程與現金票攻略工具站。本檔由 ${SITE} 的頁面資料自動產生，供 AI 助理與檢索使用。`);
P(`> 產生日期：${today}。哩程數字為整理值，開票前請以各航空公司官網為準。`);
P(``);

/* ── 1. 阿拉斯加 × 星宇 中停 ── */
P(`## 1. 阿拉斯加哩程開星宇：免費中停台灣 14 天`);
P(``);
P(`用 Alaska Mileage Plan 哩程開星宇（JX）「外站出發 → 中停台灣 → 第三國」單程票。`);
P(`規則：兩段皆星宇；中停台北（TPE）或台中（RMQ）最長 **14 天**；出發地與目的地須為**不同國家／地區**（港澳視為不同地區）；雙向皆可開。`);
P(``);
P(`| 兩段大圓距離合計 | 經濟艙（單程） | 商務艙（單程） |`);
P(`|---|---|---|`);
P(`| ≤ 1,500 哩 | ${n(D.PRICE.sweet.eco)} 哩 | ${n(D.PRICE.sweet.biz)} 哩 |`);
P(`| > 1,500 哩 | ${n(D.PRICE.high.eco)} 哩 | ${n(D.PRICE.high.biz)} 哩 |`);
P(``);
P(`1,500–1,600 哩為「壓線區」：AS 系統實際判定可能與大圓計算差數哩，仍常出低價，以官網查價為準。`);
P(``);
P(`### 星宇航點與距台灣樞紐距離（大圓，法定哩）`);
P(``);
const HUBL = Object.values(D.HUBS);   // 欄位跟著 HUBS 走，新增據點免改這裡
P(`| IATA | 城市 | 國家／地區 | ${HUBL.map(h => `距 ${h.code}`).join(' | ')} | 備註 |`);
P(`|---|---|---|${HUBL.map(() => '---|').join('')}---|`);
for (const a of D.AIRPORTS){
  const tags = [a.scope === 'longhaul' ? '長程線（不參與中停配對）' : '', a.scope === 'future' ? '未開航' : '',
    a.seasonal ? '季節性' : '', a.note || ''].filter(Boolean).join('；');
  const cols = HUBL.map(h => a.hubs?.includes(h.code) ? n(gc(h, a)) : '—').join(' | ');
  P(`| ${a.code} | ${a.city} | ${D.COUNTRY[a.country] || a.country} | ${cols} | ${tags || '—'} |`);
}
const planned = HUBL.filter(h => h.planned);
if (planned.length){
  P(``);
  P(planned.map(h => `${h.name}（${h.code}）為規劃中據點（${h.planned}），標示距離僅供試算，航線尚未開賣。`).join(' '));
  for (const h of planned.filter(x => x.plannedRoutes?.length)){
    P(``);
    P(`${h.name}（${h.code}）首波航線・傳聞班表（星宇尚未官宣，以官網公告為準）：`);
    for (const r of h.plannedRoutes) P(`- ${h.code} ⇄ ${r.to} ${r.name}：去 ${r.out}／回 ${r.back}／${r.freq}`);
  }
}
P(``);

/* ── 2. 哩程兌換表 ── */
P(`## 2. 哩程兌換表（各計畫）`);
P(``);
for (const [id, d] of Object.entries(D.MILE_DATA)){
  P(`### ${d.name}`);
  P(``);
  P(`${d.basisNote}`);
  P(``);
  if (d.newFrom){
    P(`#### 新制（${d.newFrom} 起，以開票日為準）三段式動態哩程・來回`);
    P(``);
    P(`| 區域 | 涵蓋 | 經濟（${D.CI_TIER_NAME.join('／')}） | 豪經 | 商務 |`);
    P(`|---|---|---|---|---|`);
    const cell = c => c ? (c.t ? c.t.map(n).join(' / ') : n(c.rt)) : '—';
    for (const z of d.zones) P(`| ${z.zone} | ${z.sub} | ${cell(z.eco)} | ${cell(z.pey)} | ${cell(z.biz)} |`);
    P(``);
    P(`單程為來回的 50%。分公司代辦一律以「稀少/候補」級距扣哩，官網自助才看得到「充足」價。`);
    P(`改票僅能改到相同或更高級距（手續費 NT$1,500），官方建議退票重開（官網退票免手續費）。`);
    P(``);
    P(`#### 現行（${d.newFrom} 前開票適用）`);
    P(``);
    P(`| 區域 | 涵蓋 | 經濟 | 豪經 | 商務 |`);
    P(`|---|---|---|---|---|`);
    for (const z of d.oldZones) P(`| ${z.zone} | ${z.sub} | ${cell(z.eco)} | ${cell(z.pey)} | ${cell(z.biz)} |`);
    P(``);
    P(`#### 新舊對照（官方 FAQ 揭露，來回）`);
    P(``);
    P(`| 航線 | 原標準 | 新制（充足） | 差 |`);
    P(`|---|---|---|---|`);
    for (const x of d.eraCompare) P(`| ${x.route} | ${n(x.old)} | ${n(x.neo)} | ${x.neo - x.old < 0 ? '↓' : '↑'}${n(Math.abs(x.neo - x.old))} |`);
    P(``);
    P(`注意：官方對照僅列「充足」級距。「稀少/候補」多數航線**高於原標準**，例：亞洲往返歐洲商務 160,000 → 210,000、亞洲往返北美商務 160,000 → 200,000。`);
  } else {
    P(`| 區域 | 涵蓋 | 經濟 | 豪經 | 商務 |`);
    P(`|---|---|---|---|---|`);
    const cell = c => c ? `${c.approx ? '約 ' : ''}${n(c.rt)}` : '—';
    for (const z of d.zones) P(`| ${z.zone} | ${z.sub} | ${cell(z.eco)} | ${cell(z.pey)} | ${cell(z.biz)} |`);
  }
  P(``);
  if (d.upgrades?.length){
    P(`升等（單一航段）：` + d.upgrades.map(u => `${u.route} ${u.miles ? n(u.miles) + ' 哩' : '依官網'}`).join('；'));
    P(``);
  }
  P(`官網：${d.site}`);
  P(``);
}

/* ── 長榮跨區規則 ── */
P(`### 長榮 2025/9/1 新制：跨區經台北的外站哩程票`);
P(``);
P(`分段所需哩程不得超過該「跨區來回」總價，否則不可開票。亞洲跨區參考值：經濟 ${n(D.BR_ASIA_X.eco)}、商務 ${n(D.BR_ASIA_X.biz)} 哩（來回）。`);
P(`經典案例：新加坡–台北–東京商務（舊制單程 25,000）已遭封殺；**經濟艙跨區多數仍可行**。`);
P(`各區最遠航點（同區哩程相同，選最遠效益最高）：`);
P(``);
for (const [k, name] of Object.entries(D.BR_ZONE_NAME)){
  const z = D.MILE_DATA.BR.zones.find(z => z.key === k);
  const apts = (D.BR_ZONE_APTS[k] || []).join('、');
  P(`- **${name}**（經濟來回 ${n(z?.eco?.rt)}）：${apts}`);
}
P(``);

/* ── 長榮效益最大化查票器：完整票規與兩張兌換表 ── */
P(`## 2b. 長榮無限萬哩遊：完整兌換表與票規（效益最大化查票器的資料）`);
P(``);
P(`### 長榮／立榮自家國際線酬賓機票（來回哩程，單程為一半）`);
P(``);
P(`| 分區 | 涵蓋 | 經濟 | 豪華經濟 | 商務 |`);
P(`|---|---|---|---|---|`);
for (const [k, z] of Object.entries(D.EV_OWN))
  P(`| ${z.name} | ${(D.BR_ZONE_APTS[k] || []).join('、') || '—'} | ${n(z.eco)} | ${n(z.pey)} | ${n(z.biz)} |`);
P(``);
P(`訂位艙等：經濟 X／豪華經濟 E／商務 I。立榮國內線來回 13,500 哩。`);
P(``);
P(`自家票開口與停留規則：`);
P(``);
for (const r of D.EV_RULES.own) P(`- ${r}`);
P(``);
P(`### 兌換星空聯盟航班（單位千哩、來回；單程為一半）`);
P(``);
for (const [cab, label] of [['eco','經濟艙'],['biz','商務艙'],['fst','頭等艙']]){
  P(`#### ${label}`);
  P(``);
  const cols = D.EV_Z.slice(1);
  P(`| 起點＼終點 | ${cols.map(z => D.EV_ZN[z]).join(' | ')} |`);
  P(`|${'---|'.repeat(cols.length + 1)}`);
  for (const r of D.EV_Z)
    P(`| ${D.EV_ZN[r]} | ${cols.map(c => {
      const ir = D.EV_Z.indexOf(r), ic = D.EV_Z.indexOf(c);
      return ir <= ic ? (D.EV_CHART[cab][ir][ic - 1] || '–') : '–';
    }).join(' | ')} |`);
  P(``);
}
P(`星盟票開口與停留規則（含 2025/9/1 三條新制）：`);
P(``);
for (const r of D.EV_RULES.sa) P(`- ${r}`);
P(``);
P(`跨區禁行的三大板塊：${Object.entries({ AM:'美洲', EA:'歐洲／非洲／中東', AP:'亞洲／西南太平洋' })
  .map(([g, name]) => `**${name}**＝${D.EV_Z.filter(z => D.EV_BLOC[z] === g).map(z => D.EV_ZN[z]).join('、')}`).join('；')}。`);
P(``);
P(`### 免費中停怎麼成立`);
P(``);
P(`星盟票的計價基準＝「出發地 → 折返點」，而折返點是系統認定「距出發地所需哩程最高」的那一點。`);
P(`所以任何一個所需哩程 **不超過基準** 的城市，都可以當停留點而完全不加價 — 這就是免費中停。`);
P(`例：台北出發商務艙，台灣→歐洲 ${n(evPrice('tw','eur','biz'))} 哩是基準，`);
P(`台灣→東南亞 ${n(evPrice('tw','sea','biz'))}、台灣→中東 ${n(evPrice('tw','me','biz'))}、`);
P(`台灣→北非 ${n(evPrice('tw','naf','biz'))} 都低於基準，因此曼谷、伊斯坦堡、開羅都能免費停留；`);
P(`分開換要 ${n(evPrice('tw','eur','biz') + evPrice('tw','sea','biz') + evPrice('tw','me','biz'))} 哩，一起開只要 ${n(evPrice('tw','eur','biz'))} 哩。`);
P(`長榮自家票則是「三個航段以上取最高的那一格」，所以外站出發、中停台北再飛長程，`);
P(`一樣只付長程那一格：例如曼谷→台北（停留）→洛杉磯 商務來回 ${n(D.EV_OWN.amw.biz)} 哩，`);
P(`分開換要 ${n(D.EV_OWN.asia.biz + D.EV_OWN.amw.biz)} 哩。`);
P(``);
P(`### 星空聯盟環球酬賓機票`);
P(``);
P(`經濟 ${n(D.EV_RTW.eco)}／商務 ${n(D.EV_RTW.biz)}／頭等 ${n(D.EV_RTW.fst)} 哩。`);
for (const r of D.EV_RTW.rules) P(`- ${r}`);
P(``);
P(`### 酬賓機票的相關費用（2026/8 起）`);
P(``);
P(`| 項目 | 金額 | 備註 |`);
P(`|---|---|---|`);
for (const f of D.EV_FEES.rows) P(`| ${f.item} | ${f.v} | ${f.note || ''} |`);
P(``);
P(`${D.EV_FEES.changeNote}稅金另計，只能用現金或信用卡支付。`);
P(``);
P(`### 升等哩程（單一航段）`);
P(``);
P(`| 升等方向 | ${D.EV_UP_PEY.cols.join(' | ')} |`);
P(`|${'---|'.repeat(D.EV_UP_PEY.cols.length + 1)}`);
for (const r of D.EV_UP_PEY.rows) P(`| ${r.r} | ${r.v.map(v => `${n(v[0])} ／ ${n(v[1])}`).join(' | ')} |`);
P(``);
P(`${D.EV_UP_PEY.note}`);
P(``);
P(`| ${D.EV_UP_NOPEY.note} | 經典 Q／H／M | 尊寵 B／Y |`);
P(`|---|---|---|`);
for (const r of D.EV_UP_NOPEY.rows) P(`| ${r[0]} | ${n(r[1])} | ${n(r[2])} |`);
P(``);
P(`| 星盟升等・台灣出發到 | 升商務艙 | 升頭等艙 |`);
P(`|---|---|---|`);
for (const r of D.EV_UP_SA.rows) P(`| ${r[0]} | ${n(r[1])} | ${n(r[2])} |`);
P(``);
P(`${D.EV_UP_SA.note}`);
P(``);
P(`### 航點分區與離境稅費估算（共 ${EV_AP.length} 個航點）`);
P(``);
P(`| 代碼 | 城市 | 國家 | 星盟區 | 自家表分區 | 長榮飛 | 離境稅費 US$ |`);
P(`|---|---|---|---|---|---|---|`);
for (const a of EV_AP)
  P(`| ${a.code} | ${a.city} | ${a.country_name} | ${a.sa_zone_name} | ${a.eva_own_zone ? D.EV_OWN[a.eva_own_zone].name : '—'} | ${a.eva_operated ? '✓' : '—'} | ${a.departure_tax_usd}${a.departure_tax_premium_usd ? `（前艙 ${a.departure_tax_premium_usd}）` : ''} |`);
P(``);
P(`離境稅費為整理值，不含航空公司的訂位服務費 YR（每張 US$${D.EV_FEES.yr}，香港出發免收）；兌換表本身不含燃油附加費。`);
P(``);

/* ── 國泰距離表 ── */
P(`### 國泰・亞洲萬里通（按總距離計價，單程里數）`);
P(``);
P(`台灣出發須經香港轉機，里程以「台北–香港＋香港–目的地」大圓距離合計後查表。`);
P(``);
P(`| 距離帶 | 上限（哩） | 經濟 | 豪經 | 商務 | 頭等 |`);
P(`|---|---|---|---|---|---|`);
const cxc = c => !c ? '—' : (c.v != null ? `${c.approx ? '約 ' : ''}${n(c.v)}` : `${n(c.lo)}–${n(c.hi)}`);
for (const b of D.CX_CHART) P(`| ${b.name} | ${Number.isFinite(b.max) ? n(b.max) : '不限'} | ${cxc(b.eco)} | ${cxc(b.pey)} | ${cxc(b.biz)} | ${cxc(b.fst)} |`);
P(``);

/* ── ANA ── */
P(`### ANA 1.5 段票（台日來回 ＋ 加掛一段）`);
P(``);
P(`台日來回：經濟 ${n(D.NH_PRICE.two.eco)}／商務 ${n(D.NH_PRICE.two.biz)} 哩。`);
P(`加掛一段日本→台灣單程（1.5 段）：經濟 ${n(D.NH_PRICE.three.eco)}／商務 ${n(D.NH_PRICE.three.biz)} 哩，等於只 +${n(D.NH_PRICE.three.eco - D.NH_PRICE.two.eco)} 哩多飛一段。`);
P(`需符合開口與台灣停留規則，搭星盟（長榮／ANA）航班，票期一年。`);
P(``);
P(`ANA 日本國內線（依區間哩程）：`);
P(``);
P(`| 區間距離 | 所需哩程（單程） |`);
P(`|---|---|`);
for (const b of D.NH_DOM_BANDS) P(`| ${Number.isFinite(b.max) ? '≤ ' + n(b.max) + ' 哩' : '更遠'} | ${n(b.eco)} |`);
P(``);

/* ── 3. 四段票 ── */
P(`## 3. 三大航四段票（外站出發、經台北折返）`);
P(``);
P(`行程結構：A（外站）→ TPE → B（折返點）→ TPE → A。外站開票常比台灣出發便宜，且能多玩台灣。`);
P(``);
for (const [id, a] of Object.entries(D.FL_AIRLINES)){
  P(`### ${a.name}（${a.code}）`);
  P(``);
  P(`- 票規：${a.rule}`);
  if (a.extra) P(`- 補充：${a.extra}`);
  P(`- 官網：${a.site}`);
  P(``);
}

/* ── 4. 跨計畫比較 ── */
P(`## 4. 跨計畫比較：同一目的地哪家最省`);
P(``);
P(`台灣出發常見航點與各計畫適用區域（— 表示未飛航或不適用）：`);
P(``);
P(`| 目的地 | 華航區域 | 長榮區域 | 星宇區域 |`);
P(`|---|---|---|---|`);
for (const [g, list] of Object.entries(D.CMP_DESTS))
  for (const [code, city, av] of list)
    P(`| ${code} ${city}（${g}） | ${av.ci || '—'} | ${av.br ? D.BR_ZONE_NAME[av.br] || av.br : '—'} | ${av.jx || '—'} |`);
P(``);
P(`哩程取得成本參考（每哩新台幣，用於「哩程數少不等於划算」的成本比較）：`);
P(Object.entries(D.CMP_RATE_DEF).map(([k, v]) => `${k} NT$${v}`).join('、') + '。');
P(``);

/* ── 5. 會籍 ── */
P(`## 5. 會籍門檻`);
P(``);
for (const [id, e] of Object.entries(D.ELITE)){
  P(`- **${e.name}**（${e.unit}）：` + e.tiers.map(t => `${t.t} ${t.approx ? '約 ' : ''}${n(t.v)}${t.extra ? ' ' + t.extra : ''}`).join('／') + `。${e.note}`);
}
P(``);
P(`哩程效期：長榮自入帳起 36 個月；華航新制過期哩程半年內可買回；阿拉斯加不過期。`);
P(``);

/* ── 6. 站上工具 ── */
P(`## 6. 網站功能索引`);
P(``);
P(`- **哩程票玩法**：AS×星宇中停計算機、四家兌換表與跨計畫比較（含華航新舊制切換）`);
P(`- **現金票攻略**：四段票排程器（自動驗票規、產生查價單、假期雷達）、每日自動甜度掃描`);
P(`- **空中動態**：台灣上空即時雷達、全球班機追蹤、桃園進出港看板、機場航班看板（TDX 官方 FIDS）`);
P(`- **我的面板**：CPM 價值計算、哩程資產、存哩目標、會籍追蹤、匯率`);
P(``);
P(`資料檔：[data.json](${SITE}data.json)（結構化）、[fares.json](${SITE}fares.json)（每日票價掃描）。`);
P(``);
P(`---`);
P(`免責：本站為個人整理工具，哩程數字可能與官網有出入，且各計畫隨時可能調整；開票前務必以航空公司官網為準。`);

writeFileSync('llms-full.txt', out.join('\n'), 'utf8');

writeFileSync('llms.txt', `# 哩程玩家工具箱

> 台灣出發的哩程與現金票攻略工具站：阿拉斯加×星宇免費中停台灣計算機、華航／長榮／星宇／國泰／ANA 哩程兌換表與跨計畫比較、三大航外站四段票排程器、即時航班雷達與機場看板。

- [完整知識庫](${SITE}llms-full.txt)：所有兌換表、票規、航點距離與門檻的純文字版
- [結構化資料](${SITE}data.json)：同一份資料的 JSON 版本
- [每日票價掃描](${SITE}fares.json)：外站四段票同航司比價結果
- [網站首頁](${SITE})：互動計算工具（資料由 JavaScript 即時計算，建議 AI 讀上方純文字檔）

## 說明

哩程數字為公開資料整理值，可能與官網有出入；華航自 2026-09-16 起改為三段式動態哩程，兌換表同時提供新舊制。開票前請以各航空公司官網為準。
`, 'utf8');

writeFileSync('data.json', JSON.stringify({
  generated: today, site: SITE,
  note: '哩程整理值，以各航空公司官網為準',
  alaska_starlux: { price: D.PRICE, stopover_days: 14, hubs: D.HUBS,
    airports: D.AIRPORTS.map(a => ({ ...a, country_name: D.COUNTRY[a.country] || a.country,
      tpe_miles: a.hubs?.includes('TPE') ? gc(D.HUBS.TPE, a) : null,
      rmq_miles: a.hubs?.includes('RMQ') ? gc(D.HUBS.RMQ, a) : null,
      hub_miles: Object.fromEntries(Object.values(D.HUBS)
        .filter(h => a.hubs?.includes(h.code)).map(h => [h.code, gc(h, a)])) })) },
  award_charts: D.MILE_DATA, ci_tiers: D.CI_TIER_NAME,
  cathay: { chart: D.CX_CHART.map(b => ({ ...b, max: Number.isFinite(b.max) ? b.max : 999999 })), airports: D.CX_AIRPORTS },
  ana: { price: D.NH_PRICE, domestic_bands: D.NH_DOM_BANDS.map(b => ({ ...b, max: Number.isFinite(b.max) ? b.max : 999999 })) },
  eva_zones: { names: D.BR_ZONE_NAME, airports: D.BR_ZONE_APTS, asia_cross: D.BR_ASIA_X },
  eva: {
    own_chart: D.EV_OWN, own_zone_rank: D.EV_OWN_RANK,
    star_alliance_zones: D.EV_Z, star_alliance_zone_names: D.EV_ZN,
    star_alliance_chart: D.EV_CHART, star_alliance_chart_unit: '千哩・來回（單程為一半）',
    cross_region_blocs: D.EV_BLOC, rules: D.EV_RULES, fees: D.EV_FEES,
    round_the_world: D.EV_RTW,
    upgrades: { own_with_premium_economy: D.EV_UP_PEY, own_without_premium_economy: D.EV_UP_NOPEY,
      star_alliance: D.EV_UP_SA },
    airports: EV_AP,
  },
  four_leg: D.FL_AIRLINES, compare_destinations: D.CMP_DESTS,
  mile_cost_ntd: D.CMP_RATE_DEF, elite: D.ELITE, programs: D.PROGRAMS,
}, null, 1), 'utf8');

writeFileSync('robots.txt', `# 歡迎 AI 助理與搜尋引擎索引；頁面資料為 JS 即時計算，請優先讀 llms-full.txt
User-agent: *
Allow: /

Sitemap: ${SITE}sitemap.xml
`, 'utf8');

writeFileSync('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE}</loc><lastmod>${today}</lastmod><priority>1.0</priority></url>
  <url><loc>${SITE}llms-full.txt</loc><lastmod>${today}</lastmod><priority>0.9</priority></url>
  <url><loc>${SITE}data.json</loc><lastmod>${today}</lastmod><priority>0.8</priority></url>
</urlset>
`, 'utf8');

console.log(`llms-full.txt ${out.join('\n').length} 字元・${out.length} 行`);

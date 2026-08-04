// 四段票甜度掃描：以 Amadeus Flight Offers Search 查多城市總價，
// 與「台北直飛來回」基準比對，輸出 fares.json 供網站顯示。
// 需要環境變數 AMADEUS_API_KEY / AMADEUS_API_SECRET（未設定則安靜跳過）。
import { writeFileSync } from 'fs';

const KEY = process.env.AMADEUS_API_KEY, SEC = process.env.AMADEUS_API_SECRET;
const HOST = process.env.AMADEUS_ENV === 'production' ? 'api.amadeus.com' : 'test.api.amadeus.com';
if (!KEY || !SEC){ console.log('未設定 Amadeus Secrets，跳過掃描。'); process.exit(0); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
const iso = d => d.toISOString().slice(0, 10);
const addD = (base, n) => { const d = new Date(base); d.setUTCDate(d.getUTCDate() + n); return d; };

const tok = await fetch(`https://${HOST}/v1/security/oauth2/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: `grant_type=client_credentials&client_id=${KEY}&client_secret=${SEC}`,
}).then(r => r.json());
if (!tok.access_token){ console.error('Amadeus 認證失敗：', JSON.stringify(tok)); process.exit(1); }
const H = { Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' };

async function search(ods, cabin){
  const body = {
    currencyCode: 'TWD',
    originDestinations: ods.map((o, i) => ({
      id: String(i + 1), originLocationCode: o[0], destinationLocationCode: o[1],
      departureDateTimeRange: { date: o[2] },
    })),
    travelers: [{ id: '1', travelerType: 'ADULT' }],
    sources: ['GDS'],
    searchCriteria: {
      maxFlightOffers: 5,
      flightFilters: {
        cabinRestrictions: [{ cabin, coverage: 'MOST_SEGMENTS', originDestinationIds: ods.map((_, i) => String(i + 1)) }],
        carrierRestrictions: { includedCarrierCodes: ['BR', 'CI', 'JX'] },
      },
    },
  };
  const r = await fetch(`https://${HOST}/v2/shopping/flight-offers`, { method: 'POST', headers: H, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (j.errors) return { error: j.errors[0]?.detail || j.errors[0]?.title || 'API error' };
  const best = (j.data || [])[0];
  if (!best) return { error: 'no offers' };
  return { price: +best.price.grandTotal, currency: best.price.currency, carrier: best.validatingAirlineCodes?.[0] || '' };
}

// 日期樣板：出發 +60 天，去程隔日轉機、B 停 7 天、台灣停 30 天
const base = addD(new Date(), 60);
const D = { d1: iso(base), d2: iso(addD(base, 1)), d3: iso(addD(base, 8)), d4: iso(addD(base, 38)) };
const ORIGINS = [['BKK', '曼谷'], ['SGN', '胡志明市'], ['CGK', '雅加達']];
const TURNS = [['NRT', '東京成田'], ['KIX', '大阪關西']];
const CABINS = ['ECONOMY', 'BUSINESS'];

const out = { scanned_at: new Date().toISOString(), env: HOST.includes('test') ? 'test' : 'production', dates: D, results: [] };
const benches = {};
for (const [b] of TURNS){
  for (const cab of CABINS){
    await sleep(700);
    benches[`${b}|${cab}`] = await search([['TPE', b, D.d2], [b, 'TPE', D.d3]], cab).catch(e => ({ error: String(e) }));
  }
}
for (const [a, an] of ORIGINS){
  for (const [b, bn] of TURNS){
    for (const cab of CABINS){
      await sleep(700);
      const four = await search([[a, 'TPE', D.d1], ['TPE', b, D.d2], [b, 'TPE', D.d3], ['TPE', a, D.d4]], cab)
        .catch(e => ({ error: String(e) }));
      out.results.push({ a, an, b, bn, cabin: cab, four, bench: benches[`${b}|${cab}`] });
    }
  }
}
writeFileSync('fares.json', JSON.stringify(out, null, 1));
console.log(`掃描完成：${out.results.filter(r => !r.four.error).length}/${out.results.length} 組取得報價（${out.env}）`);

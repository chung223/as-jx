# 四段票甜度掃描（免金鑰版）：以 fast-flights 解析 Google Flights 來回報價。
# 同航司比較：外站四段的紅利來自「同一家航司」的外站計價，故鎖定
# 星宇／長榮／華航三家，各自的 A⇄TPE＋TPE⇄B 雙來回對比自家台北直飛。
# 註：Google 多城市頁與較薄市場（多為商務艙）的來回結果不在初始 HTML，
# 來回查無時退為兩張單程相加（一樣可照訂）。
import datetime
import json
import re
import time

from fast_flights import FlightQuery, Passengers, create_query, fetch_flights_html
from selectolax.lexbor import LexborHTMLParser


def to_num(p):
    if isinstance(p, (int, float)):
        return float(p) if p > 0 else None
    n = re.sub(r"[^\d.]", "", str(p or ""))
    try:
        return float(n) if n else None
    except ValueError:
        return None


def _first_price(x):
    if isinstance(x, (int, float)) and 500 <= x <= 5_000_000:
        return x
    if isinstance(x, list):
        for i in x:
            r = _first_price(i)
            if r is not None:
                return r
    return None


def parse_flights(html):
    # 容錯版解析：只取結果區 payload[3][0]，不碰商務頁常缺的 metadata。
    p = LexborHTMLParser(html)
    s = p.css_first(r"script.ds\:1")
    if s is None:
        return []
    data = s.text().split("data:", 1)[1].rsplit(",", 1)[0]
    if data.endswith("errorHasStatus: true"):
        return []
    payload = json.loads(data)
    p3 = payload[3] if len(payload) > 3 else None
    if not p3 or not p3[0]:
        return []
    out = []
    for k in p3[0]:
        try:
            airlines = [a for a in (k[0][1] or []) if isinstance(a, str)]
            price = None
            try:
                price = k[1][0][1]
            except (IndexError, TypeError):
                pass
            if not to_num(price):
                price = _first_price(k[1] if len(k) > 1 else None)
            if to_num(price):
                out.append({"airlines": airlines, "price": price})
        except Exception:  # noqa: BLE001
            continue
    return out


def best(flights, expect=None):
    out = []
    for f in flights:
        pr = to_num(f.get("price"))
        if not pr:
            continue
        names = f.get("airlines", [])
        # 航司過濾保險：結果須含目標航司（Google 端已過濾，此為雙重確認）
        if expect and names and not any(expect in n for n in names):
            continue
        out.append({"airline": "／".join(names[:2]), "price": pr, "raw": f"NT${pr:,.0f}"})
    out.sort(key=lambda x: x["price"])
    return out[0] if out else None


def q(legs, seat, trip, al=None, expect=None, tries=2):
    last_err = "查無報價（Google 未回結果）"
    for _ in range(tries):
        try:
            query = create_query(
                flights=[FlightQuery(date=d, from_airport=a, to_airport=b,
                                     airlines=[al] if al else None) for d, a, b in legs],
                seat=seat, trip=trip, passengers=Passengers(adults=1),
                currency="TWD", language="zh-TW",
            )
            b_ = best(parse_flights(fetch_flights_html(query)), expect)
            if b_:
                return b_
        except Exception as e:  # noqa: BLE001
            tb = e.__traceback__
            while tb and tb.tb_next:
                tb = tb.tb_next
            loc = f" @ {tb.tb_frame.f_code.co_filename.rsplit('/', 1)[-1]}:{tb.tb_lineno}" if tb else ""
            last_err = f"{type(e).__name__}: {e}{loc}"[:200]
        time.sleep(8)
    return {"error": last_err}


def q_rt(a, b, d_out, d_back, seat, al, expect):
    r = q([(d_out, a, b), (d_back, b, a)], seat, "round-trip", al, expect)
    if "error" not in r:
        return r
    o1 = q([(d_out, a, b)], seat, "one-way", al, expect)
    o2 = q([(d_back, b, a)], seat, "one-way", al, expect)
    if "error" in o1 or "error" in o2:
        return r
    total = o1["price"] + o2["price"]
    names = "／".join(dict.fromkeys([o1["airline"], o2["airline"]]))
    return {"price": total, "raw": f"NT${total:,.0f}（單程相加）", "airline": names, "basis": "ow-sum"}


base = datetime.date.today() + datetime.timedelta(days=60)
D = {k: (base + datetime.timedelta(days=n)).isoformat() for k, n in
     {"d1": 0, "d2": 1, "d3": 8, "d4": 38}.items()}
ORIGINS = [("BKK", "曼谷"), ("SGN", "胡志明市"), ("CGK", "雅加達")]
TURNS = [("NRT", "東京成田"), ("KIX", "大阪關西")]
CABINS = [("economy", "ECONOMY"), ("business", "BUSINESS")]
AIRLINES = [("JX", "星宇", "星宇"), ("BR", "長榮", "長榮"), ("CI", "華航", "中華")]

now_iso = datetime.datetime.now(datetime.UTC).isoformat(timespec="seconds").replace("+00:00", "Z")
out = {"scanned_at": now_iso, "env": "google-flights", "mode": "same-airline", "dates": D, "results": []}

benches = {}   # (b, cab, al) → 該航司 TPE⇄B 來回（直飛基準）
for b, bn in TURNS:
    for seat, cab in CABINS:
        for al, aln, expect in AIRLINES:
            time.sleep(3)
            benches[(b, cab, al)] = q_rt("TPE", b, D["d2"], D["d3"], seat, al, expect)
arts = {}      # (a, cab, al) → 該航司 A⇄TPE 來回
for a, an in ORIGINS:
    for seat, cab in CABINS:
        for al, aln, expect in AIRLINES:
            time.sleep(3)
            arts[(a, cab, al)] = q_rt(a, "TPE", D["d1"], D["d4"], seat, al, expect)

for a, an in ORIGINS:
    for b, bn in TURNS:
        for seat, cab in CABINS:
            als = {}
            for al, aln, expect in AIRLINES:
                ra, rb = arts[(a, cab, al)], benches[(b, cab, al)]
                if "error" in ra or "error" in rb:
                    als[al] = {"n": aln, "error": ra.get("error") or rb.get("error")}
                    continue
                total = ra["price"] + rb["price"]
                basis = "（單程相加）" if (ra.get("basis") or rb.get("basis")) else ""
                als[al] = {"n": aln,
                           "four": {"price": total, "raw": f"NT${total:,.0f}{basis}"},
                           "bench": rb}
            out["results"].append({"a": a, "an": an, "b": b, "bn": bn, "cabin": cab, "als": als})

with open("fares.json", "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=1)
ok = sum(1 for r in out["results"] if any("four" in v for v in r["als"].values()))
print(f"掃描完成：{ok}/{len(out['results'])} 組至少一家航司取得同航司報價")

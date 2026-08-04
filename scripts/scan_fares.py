# 四段票甜度掃描（免金鑰版）：以 fast-flights 解析 Google Flights 來回報價。
# 註：Google 多城市頁的初始 HTML 不含航班結果（前端動態載入），無法直接抓；
# 改用可實際照訂的「雙來回拆票」估價：A⇄TPE（d1/d4）＋ TPE⇄B（d2/d3），
# 另附台北直飛來回（TPE⇄B）基準，供四段票分頁比較。
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
    # 深度優先找第一個合理票價數字（保險用）
    if isinstance(x, (int, float)) and 500 <= x <= 5_000_000:
        return x
    if isinstance(x, list):
        for i in x:
            r = _first_price(i)
            if r is not None:
                return r
    return None


def parse_flights(html):
    # 容錯版解析：只取結果區 payload[3][0]。fast-flights 內建解析器會先讀
    # payload[7]（航司名錄 metadata），商務艙頁面該欄常為 None 導致整個炸掉。
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


def best(flights):
    out = []
    for f in flights:
        pr = to_num(f.get("price"))
        if pr:
            names = "／".join(f.get("airlines", [])[:2])
            out.append({"airline": names, "price": pr, "raw": f"NT${pr:,.0f}"})
    out.sort(key=lambda x: x["price"])
    return out[0] if out else None


def q_rt(a, b, d_out, d_back, seat):
    last_err = "查無報價（Google 未回結果）"
    for _ in range(3):
        try:
            query = create_query(
                flights=[FlightQuery(date=d_out, from_airport=a, to_airport=b),
                         FlightQuery(date=d_back, from_airport=b, to_airport=a)],
                seat=seat, trip="round-trip", passengers=Passengers(adults=1),
                currency="TWD", language="zh-TW",
            )
            b_ = best(parse_flights(fetch_flights_html(query)))
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


base = datetime.date.today() + datetime.timedelta(days=60)
D = {k: (base + datetime.timedelta(days=n)).isoformat() for k, n in
     {"d1": 0, "d2": 1, "d3": 8, "d4": 38}.items()}
ORIGINS = [("BKK", "曼谷"), ("SGN", "胡志明市"), ("CGK", "雅加達")]
TURNS = [("NRT", "東京成田"), ("KIX", "大阪關西")]
CABINS = [("economy", "ECONOMY"), ("business", "BUSINESS")]

out = {"scanned_at": datetime.datetime.now(datetime.UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
       "env": "google-flights", "mode": "two-rt", "dates": D, "results": []}
benches = {}   # TPE⇄B（也是直飛基準）
for b, bn in TURNS:
    for seat, cab in CABINS:
        time.sleep(3)
        benches[f"{b}|{cab}"] = q_rt("TPE", b, D["d2"], D["d3"], seat)
arts = {}      # A⇄TPE（外站來回）
for a, an in ORIGINS:
    for seat, cab in CABINS:
        time.sleep(3)
        arts[f"{a}|{cab}"] = q_rt(a, "TPE", D["d1"], D["d4"], seat)
for a, an in ORIGINS:
    for b, bn in TURNS:
        for seat, cab in CABINS:
            ra, rb = arts[f"{a}|{cab}"], benches[f"{b}|{cab}"]
            if "error" in ra or "error" in rb:
                four = {"error": ra.get("error") or rb.get("error")}
            else:
                total = ra["price"] + rb["price"]
                four = {"price": total, "raw": f"NT${total:,.0f}",
                        "airline": f"{ra['airline']}＋{rb['airline']}",
                        "parts": {"out": ra, "inn": rb}}
            out["results"].append({"a": a, "an": an, "b": b, "bn": bn, "cabin": cab,
                                   "four": four, "bench": rb})

with open("fares.json", "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=1)
ok = sum(1 for r in out["results"] if "error" not in r["four"])
print(f"掃描完成：{ok}/{len(out['results'])} 組取得報價")

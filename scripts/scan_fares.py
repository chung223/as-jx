# 四段票甜度掃描（免金鑰版）：以 fast-flights 解析 Google Flights
# 多城市總價與台北直飛來回基準，輸出 fares.json 供網站顯示。
import datetime
import json
import re
import time

from fast_flights import FlightQuery, Passengers, create_query, get_flights


def to_num(p):
    if isinstance(p, (int, float)):
        return float(p) if p > 0 else None
    n = re.sub(r"[^\d.]", "", str(p or ""))
    try:
        return float(n) if n else None
    except ValueError:
        return None


def air_names(f):
    # 3.0 的 airlines 依查詢型態可能是字串或 Airline 物件
    names = []
    for a in (getattr(f, "airlines", None) or [])[:2]:
        names.append(a if isinstance(a, str) else (getattr(a, "name", "") or getattr(a, "code", "")))
    return "／".join(n for n in names if n)


def best(results):
    out = []
    for f in results or []:
        pr = to_num(getattr(f, "price", None))
        if pr:
            out.append({"airline": air_names(f), "price": pr, "raw": f"NT${pr:,.0f}"})
    out.sort(key=lambda x: x["price"])
    return out[0] if out else None


def q(legs, seat, trip):
    last_err = "no offers"
    for _ in range(2):
        try:
            query = create_query(
                flights=[FlightQuery(date=d, from_airport=a, to_airport=b)
                         for a, b, d in legs],
                seat=seat, trip=trip, passengers=Passengers(adults=1),
                currency="TWD", language="zh-TW",
            )
            b_ = best(get_flights(query))
            if b_:
                return b_
        except Exception as e:  # noqa: BLE001
            tb = e.__traceback__
            while tb and tb.tb_next:
                tb = tb.tb_next
            loc = f" @ {tb.tb_frame.f_code.co_filename.rsplit('/', 1)[-1]}:{tb.tb_lineno}" if tb else ""
            last_err = f"{type(e).__name__}: {e}{loc}"[:200]
        time.sleep(5)
    return {"error": last_err}


base = datetime.date.today() + datetime.timedelta(days=60)
D = {k: (base + datetime.timedelta(days=n)).isoformat() for k, n in
     {"d1": 0, "d2": 1, "d3": 8, "d4": 38}.items()}
ORIGINS = [("BKK", "曼谷"), ("SGN", "胡志明市"), ("CGK", "雅加達")]
TURNS = [("NRT", "東京成田"), ("KIX", "大阪關西")]
CABINS = [("economy", "ECONOMY"), ("business", "BUSINESS")]

out = {"scanned_at": datetime.datetime.utcnow().isoformat(timespec="seconds") + "Z",
       "env": "google-flights", "dates": D, "results": []}
benches = {}
for b, bn in TURNS:
    for seat, cab in CABINS:
        time.sleep(3)
        benches[f"{b}|{cab}"] = q([("TPE", b, D["d2"]), (b, "TPE", D["d3"])], seat, "round-trip")
for a, an in ORIGINS:
    for b, bn in TURNS:
        for seat, cab in CABINS:
            time.sleep(3)
            four = q([(a, "TPE", D["d1"]), ("TPE", b, D["d2"]),
                      (b, "TPE", D["d3"]), ("TPE", a, D["d4"])], seat, "multi-city")
            out["results"].append({"a": a, "an": an, "b": b, "bn": bn, "cabin": cab,
                                   "four": four, "bench": benches[f"{b}|{cab}"]})

with open("fares.json", "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=1)
ok = sum(1 for r in out["results"] if "error" not in r["four"])
print(f"掃描完成：{ok}/{len(out['results'])} 組取得報價")

# 四段票甜度掃描（免金鑰版）：以 fast-flights 解析 Google Flights
# 多城市總價與台北直飛來回基準，輸出 fares.json 供網站顯示。
import json, re, time, datetime
from fast_flights import FlightData, Passengers, get_flights

def parse_price(p):
    n = re.sub(r"[^\d.]", "", p or "")
    try:
        return float(n) if n else None
    except ValueError:
        return None

def best(flights):
    out = []
    for f in flights or []:
        pr = parse_price(getattr(f, "price", None))
        if pr:
            out.append({"airline": getattr(f, "name", ""), "price": pr, "raw": f.price})
    out.sort(key=lambda x: x["price"])
    return out[0] if out else None

def q(legs, seat, trip):
    last_err = "no offers"
    for mode in ("common", "fallback"):
        try:
            r = get_flights(
                flight_data=[FlightData(date=d, from_airport=a, to_airport=b) for a, b, d in legs],
                trip=trip,
                seat=seat,
                passengers=Passengers(adults=1),
                fetch_mode=mode,
            )
            b_ = best(getattr(r, "flights", None))
            if b_:
                return b_
        except Exception as e:  # noqa: BLE001
            last_err = str(e)[:200]
        time.sleep(2)
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

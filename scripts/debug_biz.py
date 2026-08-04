# 臨時診斷：外站⇄TPE 商務來回為何無結果；單程拆查是否可行。
import json

from fast_flights import FlightQuery, Passengers, create_query, fetch_flights_html
from selectolax.lexbor import LexborHTMLParser


def status(html, label):
    p = LexborHTMLParser(html)
    s = p.css_first(r"script.ds\:1")
    if s is None:
        print(label, "→ 無 ds:1")
        return
    data = s.text().split("data:", 1)[1].rsplit(",", 1)[0]
    err = data.endswith("errorHasStatus: true")
    payload = json.loads(data)
    p3 = payload[3] if len(payload) > 3 else None
    n = 0 if (not p3 or not p3[0]) else len(p3[0])
    print(label, f"→ err={err} payload[3]={'None' if p3 is None else 'list'} 結果數={n} html={len(html)}")
    if n:
        k = p3[0][0]
        print("  首筆航司:", [a for a in (k[0][1] or []) if isinstance(a, str)],
              "價格:", k[1][0][1] if len(k) > 1 else "?")


def q(legs, seat, trip, label):
    qq = create_query(
        flights=[FlightQuery(date=d, from_airport=a, to_airport=b) for d, a, b in legs],
        seat=seat, trip=trip, passengers=Passengers(adults=1),
        currency="TWD", language="zh-TW",
    )
    status(fetch_flights_html(qq), label)


for a in ("BKK", "SGN"):
    q([("2026-10-03", a, "TPE"), ("2026-11-10", "TPE", a)], "business", "round-trip", f"{a}⇄TPE 商務來回")
    q([("2026-10-03", a, "TPE")], "business", "one-way", f"{a}→TPE 商務單程")
    q([("2026-11-10", "TPE", a)], "business", "one-way", f"TPE→{a} 商務單程")
q([("2026-10-03", "BKK", "TPE"), ("2026-11-10", "TPE", "BKK")], "economy", "round-trip", "BKK⇄TPE 經濟來回（對照）")

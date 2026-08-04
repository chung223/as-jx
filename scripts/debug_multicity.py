# 臨時診斷（僅手動觸發時執行）：印出 Google Flights 多城市頁面的
# payload 結構，用來定位 fast-flights 解析器在多城市的 IndexError。
import json

from fast_flights import FlightQuery, Passengers, create_query, fetch_flights_html
from selectolax.lexbor import LexborHTMLParser

q = create_query(
    flights=[FlightQuery(date="2026-10-03", from_airport="BKK", to_airport="TPE"),
             FlightQuery(date="2026-10-04", from_airport="TPE", to_airport="NRT"),
             FlightQuery(date="2026-10-11", from_airport="NRT", to_airport="TPE"),
             FlightQuery(date="2026-11-10", from_airport="TPE", to_airport="BKK")],
    seat="economy", trip="multi-city", passengers=Passengers(adults=1),
    currency="TWD", language="zh-TW",
)
html = fetch_flights_html(q)
print("html len:", len(html))
p = LexborHTMLParser(html)
script = p.css_first(r"script.ds\:1")
if script is None:
    print("no ds:1 script; classes:",
          [s.attributes.get("class") for s in p.css("script")][:20])
    raise SystemExit(0)

js = script.text()
data = js.split("data:", 1)[1].rsplit(",", 1)[0]
print("errorHasStatus:", data.endswith("errorHasStatus: true"))
payload = json.loads(data)


def shape(x, depth=0):
    if isinstance(x, list):
        if depth >= 3:
            return f"list[{len(x)}]"
        inner = ",".join(shape(i, depth + 1) for i in x[:6])
        return f"list[{len(x)}]({inner})" if x else "list[0]"
    return type(x).__name__


print("len(payload):", len(payload))
for i in range(min(len(payload), 10)):
    print(f"payload[{i}]:", shape(payload[i]))
try:
    p3 = payload[3]
    print("payload[3][0]:", "None" if p3[0] is None else f"len {len(p3[0])}")
    if p3[0]:
        k = p3[0][0]
        print("k:", shape(k))
        print("k dump:", json.dumps(k, ensure_ascii=False)[:900])
except Exception:
    import traceback
    traceback.print_exc()
try:
    print("payload[7][1]:", shape(payload[7][1]))
except Exception as e:
    print("payload[7] ERR:", e)

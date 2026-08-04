# 臨時診斷（僅手動觸發時執行）：定位 Google Flights 多城市頁面中
# 航班結果實際所在的 payload 位置（ds:N script 與索引）。
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

# 1) 掃所有 ds:N script，看哪個含有航點代碼（結果所在處）
cands = []
for s in p.css("script"):
    cls = (s.attributes.get("class") or "")
    if not cls.startswith("ds:"):
        continue
    js = s.text()
    if "data:" not in js:
        continue
    data = js.split("data:", 1)[1].rsplit(",", 1)[0]
    nb, nt = data.count('"BKK"'), data.count('"TPE"')
    print(f"{cls}: len={len(data)} BKK={nb} TPE={nt}")
    if nb or nt:
        cands.append((cls, data))

# 2) 對每個候選 script 解析 payload，找出含 BKK 的頂層索引並傾印開頭
for cls, data in cands:
    try:
        payload = json.loads(data)
    except Exception as e:  # noqa: BLE001
        print(cls, "json ERR:", str(e)[:80])
        continue
    print(f"--- {cls}: len(payload)={len(payload)}")
    for i, slot in enumerate(payload):
        d = json.dumps(slot, ensure_ascii=False)
        if '"BKK"' in d or '"TPE"' in d:
            print(f"[{cls}][{i}] len={len(d)} head={d[:1200]}")

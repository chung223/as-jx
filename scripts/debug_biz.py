# 臨時診斷：商務艙查詢為何無結果——比對 fast-flights 產生的 tfs
# 與自建編碼器（與網站 gfMultiUrl 同規格）的差異及實際解析結果。
import base64
import json

from fast_flights import FlightQuery, Passengers, create_query, fetch_flights_html
from primp import Client
from selectolax.lexbor import LexborHTMLParser

LEGS = [("2026-10-04", "TPE", "NRT"), ("2026-10-11", "NRT", "TPE")]


def check(html, label):
    p = LexborHTMLParser(html)
    s = p.css_first(r"script.ds\:1")
    if not s:
        print(label, "→ 無 ds:1 script")
        return
    data = s.text().split("data:", 1)[1].rsplit(",", 1)[0]
    payload = json.loads(data)
    p3 = payload[3]
    n = 0 if (p3 is None or not p3 or p3[0] is None) else len(p3[0])
    print(label, "→ payload[3]:", "None" if p3 is None else f"list[{len(p3)}]", "結果數:", n)


def hexdump(b64):
    pad = b64 + "=" * (-len(b64) % 4)
    return base64.urlsafe_b64decode(pad).hex()


# 1) fast-flights 產生的查詢
for seat in ("economy", "business"):
    q = create_query(
        flights=[FlightQuery(date=d, from_airport=a, to_airport=b) for d, a, b in LEGS],
        seat=seat, trip="round-trip", passengers=Passengers(adults=1),
        currency="TWD", language="zh-TW",
    )
    params = q.params()
    tfs = params.get("tfs", "")
    print(f"lib {seat} tfs={tfs}")
    print(f"lib {seat} hex={hexdump(tfs)}")
    check(fetch_flights_html(q), f"lib {seat}")


# 2) 自建編碼器（同網站 gfMultiUrl 規格）
def _vint(n):
    out = bytearray()
    while n > 127:
        out.append((n & 127) | 128)
        n >>= 7
    out.append(n)
    return bytes(out)


def _pb_str(f, s):
    b = s.encode()
    return _vint(f << 3 | 2) + _vint(len(b)) + b


def _pb_msg(f, payload):
    return _vint(f << 3 | 2) + _vint(len(payload)) + payload


def _pb_num(f, v):
    return _vint(f << 3) + _vint(v)


def own_tfs(legs, seat, trip):
    info = b""
    for d, a, b in legs:
        info += _pb_msg(3, _pb_str(2, d) + _pb_msg(13, _pb_str(2, a)) + _pb_msg(14, _pb_str(2, b)))
    info += _pb_num(8, 1) + _pb_num(9, seat) + _pb_num(19, trip)
    return base64.urlsafe_b64encode(info).decode().rstrip("=")


for seat_v, lbl in ((1, "economy"), (3, "business")):
    t = own_tfs(LEGS, seat_v, 1)  # trip 1=來回
    print(f"own {lbl} tfs={t}")
    c = Client(impersonate="chrome_145", impersonate_os="macos", referer=True, cookie_store=True)
    html = c.get("https://www.google.com/travel/flights",
                 params={"tfs": t, "hl": "zh-TW", "curr": "TWD"}).text
    check(html, f"own {lbl}")

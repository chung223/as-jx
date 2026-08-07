# 機場航班看板：TDX 民航 FIDS 官方資料，每 30 分鐘由 GitHub Actions 執行。
# 金鑰僅存於 GitHub Secrets；免費金鑰限每分鐘 5 次呼叫，故 6 個請求間隔 13 秒。
# 產出 tdx.json 只進 Pages 部署、不進版控（避免高頻資料 commit）。
import datetime
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

AUTH = "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token"
BASE = "https://tdx.transportdata.tw/api/basic/v2/Air/FIDS/Airport"
APTS = ["TPE", "TSA", "KHH"]


def http(url, data=None, headers=None, tries=3):
    # 金鑰與姊妹站「快轉」共用：撞到 TDX 每分鐘限流時等 65 秒重試，而非直接失敗
    for i in range(tries):
        req = urllib.request.Request(url, data=data, headers=headers or {})
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 429 and i < tries - 1:
                print("  (429 rate limited, retrying in 65s)")
                time.sleep(65)
                continue
            raise


def hm(s):
    try:
        return datetime.datetime.fromisoformat(s).strftime("%H:%M")
    except (TypeError, ValueError):
        return ""


tok = json.loads(http(AUTH, urllib.parse.urlencode({
    "grant_type": "client_credentials",
    "client_id": os.environ["TDX_ID"],
    "client_secret": os.environ["TDX_SECRET"],
}).encode()))["access_token"]
H = {"Authorization": f"Bearer {tok}"}

now = (datetime.datetime.now(datetime.UTC) + datetime.timedelta(hours=8)).replace(tzinfo=None)
lo, hi = now - datetime.timedelta(hours=1, minutes=30), now + datetime.timedelta(hours=12)


def norm(rows, kind):
    p = "Departure" if kind == "dep" else "Arrival"
    groups = {}
    for r in rows:
        if r.get("IsCargo"):
            continue
        st, et, at = r.get(f"Schedule{p}Time"), r.get(f"Estimated{p}Time"), r.get(f"Actual{p}Time")
        t = at or et or st
        try:
            tt = datetime.datetime.fromisoformat(t)
        except (TypeError, ValueError):
            continue
        if not (lo <= tt <= hi):
            continue
        other = r.get("ArrivalAirportID" if kind == "dep" else "DepartureAirportID") or ""
        fno = f"{r.get('AirlineID', '')}{r.get('FlightNumber', '')}"
        key = (st, other, (r.get("Gate") or "").strip())
        g = groups.get(key)
        if g:
            # 同班多班號＝共掛；有機型者視為承運班號
            if r.get("AcType") and not g["ac"]:
                g["cs"].append(g["f"])
                g["f"], g["ac"] = fno, r.get("AcType") or ""
            else:
                g["cs"].append(fno)
            continue
        groups[key] = {
            "f": fno, "cs": [], "o": other,
            "st": hm(st), "et": hm(et), "at": hm(at),
            "rm": (r.get(f"{p}Remark") or "").strip(),
            "gate": (r.get("Gate") or "").strip(),
            "term": (r.get("Terminal") or "").strip(),
            "belt": (r.get("BaggageClaim") or "").strip(),
            # 報到櫃台（出發班機；供機捷快轉「前往機場」整合使用）
            "ck": (r.get("CheckCounter") or r.get("CheckinCounter") or "").strip(),
            "ac": r.get("AcType") or "",
            "_t": t,
        }
    out = sorted(groups.values(), key=lambda x: x["_t"])[:70]
    for x in out:
        x.pop("_t", None)
    return out


data = {"updated_at": now.strftime("%Y-%m-%d %H:%M"), "airports": {}}
first = True
for a in APTS:
    d = {}
    for kind, path in (("dep", "Departure"), ("arr", "Arrival")):
        if not first:
            time.sleep(13)
        first = False
        d[kind] = norm(json.loads(http(f"{BASE}/{path}/{a}?%24format=JSON", headers=H)), kind)
    data["airports"][a] = d

with open("tdx.json", "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
print("看板筆數:", {a: {k: len(v) for k, v in d.items()} for a, d in data["airports"].items()})

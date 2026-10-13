from __future__ import annotations

import concurrent.futures
import csv
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib import parse, request

BASE_DIR = Path(__file__).resolve().parent.parent
# CSV 与接口的 lon/lat 均为上游（尼普顿）原生 BD-09（百度坐标系），此处原样传递、不做换算；
# 换算只发生在展示层，见 static/index.html 与 docs/coordinates.md。
CSV_PATH = BASE_DIR / "stations_yuquan.csv"
API_URL = "http://www.szlzxn.cn/wxn/getDeviceInfo"
AREA_ID = 6
STATUS_MAP = {"0": "free", "1": "used", "3": "fault"}


def load_stations():
    with CSV_PATH.open(encoding="utf-8") as file:
        # aliases 用 | 分隔，仅供面板搜索（如「微电子学院」→ 行政楼北侧）
        return [{"name": row["name"], "lon": float(row["lon"]), "lat": float(row["lat"]), "device_ids": json.loads(row["device_ids"]), "aliases": [a.strip() for a in (row.get("aliases") or "").split("|") if a.strip()]} for row in csv.DictReader(file)]


def as_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def fetch_device(device_id):
    body = parse.urlencode({"areaId": AREA_ID, "devaddress": device_id}).encode("utf-8")
    req = request.Request(API_URL, data=body, headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with request.urlopen(req, timeout=8) as response:
            return json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        return {"_error": f"{type(exc).__name__}: {exc}"}


def status_payload():
    stations = load_stations()
    tasks = [(station, device_id) for station in stations for device_id in station["device_ids"]]
    results = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(fetch_device, device_id): device_id for _, device_id in tasks}
        for future in concurrent.futures.as_completed(futures):
            results[futures[future]] = future.result()

    errors = []
    output = []
    for station in stations:
        counts = {"free": 0, "used": 0, "fault": 0, "other": 0}
        devices = []
        for device_id in station["device_ids"]:
            result = results.get(device_id, {})
            if "_error" in result or result.get("success") is not True:
                error = result.get("_error") or result.get("msg") or "请求失败"
                errors.append(f"{station['name']}#{device_id}: {error}")
                devices.append({"id": str(device_id), "reachable": False, "error": error, "lon": None, "lat": None, **counts.copy(), "total": 0, "ports": []})
                continue
            ports = []
            device_counts = {"free": 0, "used": 0, "fault": 0, "other": 0}
            obj = result.get("obj") or {}
            for char in str(obj.get("portstatur", "")):
                status = STATUS_MAP.get(char, "other")
                ports.append(status)
                device_counts[status] += 1
                counts[status] += 1
            devices.append({
                "id": str(device_id), "reachable": True, "error": None,
                "lon": as_float(obj.get("longitude")), "lat": as_float(obj.get("latitude")),
                **device_counts, "total": len(ports), "ports": ports,
            })
        output.append({"name": station["name"], "lon": station["lon"], "lat": station["lat"], "aliases": station["aliases"], **counts, "total": sum(counts.values()), "reachable": any(device["reachable"] for device in devices), "devices": len(devices), "devices_detail": devices})
    return {"stations": output, "updated_at": datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds"), "last_error": "; ".join(errors[:6]) or None, "fetching": False}


from http.server import BaseHTTPRequestHandler


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = json.dumps(status_payload(), ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        pass

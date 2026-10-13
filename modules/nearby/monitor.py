#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
尼普顿充电桩监控面板（玉泉校区）

- 仅使用公开接口，无需登录、无需 token
- 仅依赖 Python 标准库，无第三方依赖
- 后台定时轮询设备状态，内置 Web 面板实时展示

运行：python monitor.py  然后浏览器访问 http://127.0.0.1:8000
"""
from __future__ import annotations

import concurrent.futures
import csv
import json
import threading
import time
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib import parse, request

BASE_DIR = Path(__file__).resolve().parent
# CSV 与接口的 lon/lat 均为上游（尼普顿）原生 BD-09（百度坐标系），此处原样传递、不做换算；
# 换算只发生在展示层，见 static/index.html 与 docs/coordinates.md。
CSV_PATH = Path(globals().get("NEPTUNE_STATIONS_CSV", BASE_DIR / "stations_yuquan.csv"))
STATIC_DIR = BASE_DIR / "static"
INDEX_FILE = STATIC_DIR / "index.html"

API_URL = "http://www.szlzxn.cn/wxn/getDeviceInfo"
AREA_ID = 6          # 实测该参数不影响结果，devaddress 决定具体设备
POLL_INTERVAL = 20   # 后台轮询间隔（秒）
HTTP_TIMEOUT = 8     # 单设备请求超时（秒）
WORKERS = 8          # 并发请求线程数
HOST = "127.0.0.1"
PORT = 8000

# portstatur 中每个字符的含义
STATUS_MAP = {"0": "free", "1": "used", "3": "fault"}


def load_stations() -> list[dict]:
    stations = []
    with CSV_PATH.open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            stations.append({
                "name": row["name"],
                "lon": float(row["lon"]),
                "lat": float(row["lat"]),
                "device_ids": json.loads(row["device_ids"]),
                # aliases 用 | 分隔，仅供面板搜索（如「微电子学院」→ 行政楼北侧）
                "aliases": [a.strip() for a in (row.get("aliases") or "").split("|") if a.strip()],
            })
    return stations


STATIONS = load_stations()

# 全局状态（供 Web 面板读取）
STATE = {"stations": [], "updated_at": None, "last_error": None, "fetching": True}
LOCK = threading.Lock()


def as_float(value):
    """接口坐标可能缺失或为字符串，统一转成 float 或 None。"""
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def fetch_device(device_id: str) -> dict:
    """请求单个设备状态，返回原始 JSON；失败时返回 {"_error": ...}。"""
    body = parse.urlencode({"areaId": AREA_ID, "devaddress": device_id}).encode("utf-8")
    req = request.Request(
        API_URL,
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        with request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as exc:  # noqa: BLE001
        return {"_error": f"{type(exc).__name__}: {exc}"}


def poll_once() -> None:
    """并发抓取所有设备，聚合为每站点统计并写入 STATE。"""
    tasks = [(s["name"], d) for s in STATIONS for d in s["device_ids"]]
    results: dict[str, dict] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as ex:
        future_map = {ex.submit(fetch_device, d): (name, d) for name, d in tasks}
        for fut in concurrent.futures.as_completed(future_map):
            _, device_id = future_map[fut]
            results[device_id] = fut.result()

    stations_out = []
    errors = []
    for s in STATIONS:
        free = used = fault = other = total = 0
        reachable = False
        devices_out = []
        for d in s["device_ids"]:
            r = results.get(d, {})
            if "_error" in r or r.get("success") is not True:
                error = r.get("_error") or r.get("msg") or "请求失败"
                errors.append(f"{s['name']}#{d}: {error}")
                devices_out.append({"id": str(d), "reachable": False, "error": error, "lon": None, "lat": None, "free": 0, "used": 0, "fault": 0, "other": 0, "total": 0, "ports": []})
                continue
            reachable = True
            obj = r.get("obj") or {}
            ps = str(obj.get("portstatur", ""))
            device_counts = {"free": 0, "used": 0, "fault": 0, "other": 0}
            device_ports = []
            for ch in ps:
                key = STATUS_MAP.get(ch, "other")
                device_counts[key] += 1
                device_ports.append(key)
            total += len(ps)
            free += device_counts["free"]
            used += device_counts["used"]
            fault += device_counts["fault"]
            other += device_counts["other"]
            devices_out.append({
                "id": str(d), "reachable": True, "error": None,
                "lon": as_float(obj.get("longitude")), "lat": as_float(obj.get("latitude")),
                **device_counts, "total": len(ps), "ports": device_ports,
            })

        stations_out.append({
            "name": s["name"], "lon": s["lon"], "lat": s["lat"], "aliases": s["aliases"],
            "free": free, "used": used, "fault": fault, "other": other,
            "total": total, "reachable": reachable,
            "devices": len(s["device_ids"]), "devices_detail": devices_out,
        })

    with LOCK:
        STATE["stations"] = stations_out
        STATE["updated_at"] = datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds")
        STATE["last_error"] = "; ".join(errors[:6]) if errors else None
        STATE["fetching"] = False


def poll_loop() -> None:
    while True:
        with LOCK:
            STATE["fetching"] = True
        try:
            poll_once()
        except Exception as exc:  # noqa: BLE001
            with LOCK:
                STATE["last_error"] = f"轮询异常: {exc}"
                STATE["fetching"] = False
        time.sleep(POLL_INTERVAL)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0]
        if path == "/api/status":
            with LOCK:
                payload = dict(STATE)
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif path in ("/", "/index.html"):
            if INDEX_FILE.exists():
                body = INDEX_FILE.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            else:
                self.send_error(404, "index.html not found")
        else:
            self.send_error(404)

    def log_message(self, *args) -> None:  # noqa: N802
        pass


def main() -> None:
    total_devices = sum(len(s["device_ids"]) for s in STATIONS)
    print(f"尼普顿充电桩监控面板 - 玉泉校区（{len(STATIONS)} 个站点，{total_devices} 个设备）")

    # 先启动后台抓取线程，再启动 Web 服务，保证页面立即可访问
    threading.Thread(target=poll_loop, daemon=True).start()

    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"面板已启动：http://{HOST}:{PORT}")
    print("数据正在后台抓取，几秒后页面会自动出现内容；Ctrl+C 退出")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已退出")


if __name__ == "__main__":
    main()

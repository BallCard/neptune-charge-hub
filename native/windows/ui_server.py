"""Loopback-only UI. Viewing reads state; reservation requires an explicit button action."""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import secrets
import subprocess
import threading
import time
import webbrowser
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib import request, error

import neptune_charge as app

ROOT = Path(__file__).resolve().parent
ASSETS = ROOT / "ui"
CONNECTION = app.LOCAL / "ui-connection.json"
SAFE_PHASES = {"ready", "submitting", "pending", "confirmed", "already-charging", "failed", "rejected", "uncertain", "expired", "cancelled"}


def read_json(path, default=None):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def latest_reservation():
    try:
        path = Path(app.LATEST.read_text(encoding="utf-8").strip())
        if path.resolve().parent != (app.LOCAL / "reservations").resolve():
            return None, None
        state = read_json(path)
        if not isinstance(state, dict) or state.get("phase") not in SAFE_PHASES:
            return None, None
        return path, state
    except OSError:
        return None, None


def current_booking(state, clock=None):
    try:
        scheduled = datetime.fromisoformat(state["scheduled_at"])
        return bool(state.get("armed")) and state["phase"] in {"ready", "submitting", "pending"} and (clock or app.now()) <= scheduled + timedelta(minutes=10)
    except (TypeError, KeyError, ValueError):
        return False


def safe_number(value):
    try:
        number = float(value)
        return number if math.isfinite(number) and 0 <= number <= 10_000_000 else None
    except (TypeError, ValueError):
        return None


def booking_tasks_healthy(tasks, state, email_enabled):
    try:
        scheduled = datetime.fromisoformat(state["scheduled_at"])
        required = {"charge": scheduled}
        if email_enabled: required["watch"] = scheduled + timedelta(minutes=15)
        return all(tasks.get(key, {}).get("matches_latest") and tasks[key].get("enabled") and
                   datetime.fromisoformat(tasks[key]["start_at"]) == at for key, at in required.items())
    except (KeyError, TypeError, ValueError):
        return False


def read_live(cfg):
    api = app.Api()  # beginCharge is explicitly unavailable to this UI reader.
    with ThreadPoolExecutor(max_workers=3) as pool:
        user_f = pool.submit(api.call, "getUserInfo", {"openId": cfg["open_id"], "areaId": cfg["area_id"]})
        device_f = pool.submit(api.call, "getDeviceInfo", {"devaddress": cfg["device"], "areaId": cfg["area_id"]})
        order_f = pool.submit(app.active_order, api, cfg)
        user = app.object_response(user_f.result(), "账户")
        device = app.object_response(device_f.result(), "设备")
        order = order_f.result()
    if str(user.get("employeeid")) != str(cfg["employee_id"]) or str(device.get("devaddress")) != cfg["device"]:
        raise app.ChargeError("账号或设备核对失败。")
    matched = app.matching(order, cfg)
    return {"connected": True, "updated_at": app.now().isoformat(), "error": None,
            "balance_cents": safe_number(user.get("readyaccountmoney")),
            "prepay_cents": safe_number(device.get("yk")), "business_open": str(device.get("isWorkTime")) == "1",
            "active_order": matched, "other_order": bool(order) and not matched,
            "power_watts": safe_number(order.get("power")) if matched else None}


class WindowsBridge:
    def invoke(self, mode):
        arguments = ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
                     "-File", str(ROOT / "schedule.ps1"), "-Mode", mode, "-NoPause"]
        if mode == "Reserve":
            arguments.append("-ConfirmedPlug")
        result = subprocess.run(arguments, cwd=ROOT, capture_output=True, timeout=100,
                                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        if result.returncode:
            text = result.stdout.decode("utf-8-sig", errors="replace")
            # Only expected user-facing failures; never expose arbitrary process output.
            candidates = [line.strip() for line in text.splitlines() if any(word in line for word in
                ("余额不足", "已有订单", "已改变", "检查未通过", "不属于本工具", "已经尝试过"))]
            raise app.ChargeError(candidates[-1] if candidates else "操作未完成，请查看最近记录并重试。")

    def tasks(self):
        result = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
                                 "-File", str(ROOT / "ui_tasks.ps1")], cwd=ROOT, capture_output=True, timeout=15,
                                 creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), check=True)
        return json.loads(result.stdout.decode("utf-8-sig"))


class Dashboard:
    def __init__(self, bridge=None, cfg_loader=app.load_account, live_reader=read_live, background=True):
        self.bridge = bridge or WindowsBridge()
        self.cfg_loader, self.live_reader = cfg_loader, live_reader
        self.lock = threading.RLock()
        self.live = {"connected": False, "updated_at": None, "error": None}
        self.tasks = {}
        self.task_error = None
        self.action = {"busy": False, "kind": None, "message": "", "success": None}
        self.activity = time.monotonic()
        self.force_live = self.force_tasks = True
        self.stop = threading.Event()
        if background:
            for kind in ("live", "tasks"):
                threading.Thread(target=self.refresh_loop, args=(kind,), daemon=True).start()

    def touch(self, force=False):
        with self.lock:
            self.activity = time.monotonic()
            if force:
                self.force_live = self.force_tasks = True

    def refresh_loop(self, kind):
        due = 0
        while not self.stop.wait(1):
            with self.lock:
                flag = self.force_live if kind == "live" else self.force_tasks
                active = time.monotonic() - self.activity < 90
                needed = active and (flag or time.monotonic() >= due)
                if not needed:
                    continue
                if kind == "live": self.force_live = False
                else: self.force_tasks = False
            try:
                if kind == "live":
                    value = self.live_reader(self.cfg_loader())
                    with self.lock: self.live = value
                else:
                    value = self.bridge.tasks()
                    with self.lock: self.tasks, self.task_error = value, None
            except Exception:
                with self.lock:
                    if kind == "live":
                        self.live = dict(self.live, connected=False, error="暂时未能连接平台，请稍后刷新。")
                    else:
                        self.task_error = "暂时未能读取电脑预约任务。"
            due = time.monotonic() + (30 if kind == "live" else 10)

    def public_state(self):
        self.touch()
        try:
            cfg = self.cfg_loader()
            target = {"device": cfg["device"], "port": cfg["port"],
                      "station": "玉泉原电工厂" if cfg["device"] == "60359118" else "已配置的充电设备"}
            private_id = cfg["open_id"]
        except Exception:
            target, private_id = None, ""
        path, raw = latest_reservation()
        reservation = None
        progress = None
        if raw:
            reservation = {key: raw.get(key) for key in ("phase", "armed", "scheduled_at", "device", "port", "finished_at", "submitted_at", "result")}
            reservation["id"] = path.name
            progress = read_json(path.with_suffix(".progress.json"))
        mail = read_json(app.LOCAL / "email.json", {})
        lines = []
        try:
            lines = app.LOG.read_text(encoding="utf-8").splitlines()[-18:]
            if private_id: lines = [line.replace(private_id, "[账号]") for line in lines]
        except OSError:
            pass
        with self.lock:
            live, tasks, action, task_error = dict(self.live), dict(self.tasks), dict(self.action), self.task_error
        try:
            live["stale"] = not live.get("updated_at") or (app.now() - datetime.fromisoformat(live["updated_at"])).total_seconds() > 75
        except ValueError:
            live["stale"] = True
        booked = current_booking(raw)
        can_cancel = False
        if booked and raw["phase"] == "ready":
            can_cancel = app.now() < datetime.fromisoformat(raw["scheduled_at"]) - timedelta(seconds=30)
        healthy = booking_tasks_healthy(tasks, raw, mail.get("enabled"))
        return {"now": app.now().isoformat(), "next_at": app.next_morning().isoformat(), "target": target,
                "reservation": reservation, "progress": progress, "booked": booked, "booking_healthy": healthy,
                "can_cancel": can_cancel, "can_reserve": bool(target and not booked and not action["busy"] and live.get("connected") and not live.get("stale") and not live.get("other_order")),
                "live": live, "tasks": tasks, "task_error": task_error, "action": action,
                "email": {"enabled": bool(mail.get("enabled")), "recipient": mail.get("recipient", "")}, "logs": lines}

    def begin_action(self, kind, body):
        with self.lock:
            if self.action["busy"]:
                raise app.ChargeError("操作正在进行，请等待结果。")
            view = self.public_state()
            if kind == "reserve":
                if body.get("confirmedPlug") is not True:
                    raise app.ChargeError("请确认车辆和充电器已接好。")
                cfg = self.cfg_loader()
                if (body.get("device"), body.get("port")) != (cfg["device"], cfg["port"]):
                    raise app.ChargeError("目标插座已变化，请刷新后核对。")
                if body.get("expectedAt") != view["next_at"]:
                    raise app.ChargeError("预约日期已变化，请刷新后核对。")
                if not view["can_reserve"]:
                    raise app.ChargeError("暂时不能预约，请先查看当前状态。")
                message = "正在核对账户、余额和插座，并登记预约…"
            elif kind == "cancel":
                if not view["can_cancel"] or body.get("reservationId") != view["reservation"]["id"]:
                    raise app.ChargeError("该预约已开始执行或发生变化，请在微信核对订单。")
                message = "正在取消本次预约…"
            else:
                raise app.ChargeError("未知操作。")
            self.action = {"busy": True, "kind": kind, "message": message, "success": None}
        threading.Thread(target=self.perform, args=(kind,), daemon=True).start()

    def perform(self, kind):
        try:
            self.bridge.invoke("Reserve" if kind == "reserve" else "Cancel")
            tasks = self.bridge.tasks()
            path, state = latest_reservation()
            if kind == "reserve":
                if not current_booking(state):
                    raise app.ChargeError("预约未能生效，请查看最近记录。")
                if not booking_tasks_healthy(tasks, state, read_json(app.LOCAL / "email.json", {}).get("enabled")):
                    raise app.ChargeError("电脑任务未全部登记，预约尚未确认；请取消后重新预约。")
                message = "预约已生效，电脑将在指定时间自动执行。"
            else:
                if state and state.get("armed"):
                    raise app.ChargeError("取消未能完成，请查看最近记录。")
                message = "预约已取消。"
            with self.lock:
                self.tasks = tasks
                self.action.update(busy=False, success=True, message=message)
        except Exception as exc:
            message = str(exc) if isinstance(exc, app.ChargeError) else "操作未完成，请查看最近记录；不要重复点击。"
            with self.lock: self.action.update(busy=False, success=False, message=message)
        self.touch(force=True)


class UiServer(ThreadingHTTPServer):
    daemon_threads = True
    def __init__(self, address, dashboard):
        self.dashboard = dashboard
        self.token = secrets.token_urlsafe(32)
        super().__init__(address, Handler)
        self.origin = f"http://127.0.0.1:{self.server_port}"


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # No access log containing headers or session credentials.

    def reply(self, status, data, content_type="application/json; charset=utf-8"):
        payload = json.dumps(data, ensure_ascii=False).encode() if isinstance(data, (dict, list)) else data
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
        self.end_headers()
        try: self.wfile.write(payload)
        except (BrokenPipeError, ConnectionResetError): pass

    def allowed(self, api=False, write=False):
        if self.headers.get("Host") != f"127.0.0.1:{self.server.server_port}":
            self.reply(403, {"error": "只允许本机访问。"}); return False
        if api and not secrets.compare_digest(self.headers.get("X-Neptune-Session", ""), self.server.token):
            self.reply(403, {"error": "请从本机入口重新打开界面。"}); return False
        if write and (self.headers.get("Origin") != self.server.origin or self.headers.get("Content-Type") != "application/json"):
            self.reply(403, {"error": "请求来源不匹配。"}); return False
        return True

    def do_GET(self):
        if not self.allowed(api=self.path.startswith("/api/")): return
        if self.path == "/health":
            self.reply(200, {"app": "neptune-charge-ui"}); return
        if self.path == "/api/state":
            self.reply(200, self.server.dashboard.public_state()); return
        allowed_assets = {"/": ("index.html", "text/html; charset=utf-8"), "/app.js": ("app.js", "text/javascript; charset=utf-8"), "/style.css": ("style.css", "text/css; charset=utf-8")}
        if self.path not in allowed_assets:
            self.reply(404, {"error": "页面不存在。"}); return
        name, mime = allowed_assets[self.path]
        content = (ASSETS / name).read_bytes()
        if name == "index.html": content = content.replace(b"__SESSION__", self.server.token.encode())
        self.reply(200, content, mime)

    def do_POST(self):
        if not self.allowed(api=True, write=True): return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 2048: raise ValueError()
            body = json.loads(self.rfile.read(size))
            if not isinstance(body, dict): raise ValueError()
        except (ValueError, TypeError):
            self.reply(400, {"error": "请求内容不正确。"}); return
        if self.path == "/api/refresh":
            self.server.dashboard.touch(force=True)
            self.reply(202, {"ok": True}); return
        if self.path not in {"/api/reserve", "/api/cancel"}:
            self.reply(404, {"error": "操作不存在。"}); return
        try:
            self.server.dashboard.begin_action(self.path.rsplit("/", 1)[1], body)
            self.reply(202, {"ok": True})
        except app.ChargeError as exc:
            self.reply(409, {"error": str(exc)})


def main():
    parser = argparse.ArgumentParser(description="尼普顿充电助手本机界面")
    parser.add_argument("--open", action="store_true")
    args = parser.parse_args()
    app.LOCAL.mkdir(parents=True, exist_ok=True)
    old = read_json(CONNECTION, {})
    url = old.get("url", "")
    if re.fullmatch(r"http://127\.0\.0\.1:\d+", url):
        try:
            with request.urlopen(url + "/health", timeout=2) as response:
                if json.load(response).get("app") == "neptune-charge-ui":
                    if args.open: webbrowser.open(url)
                    return 0
        except (OSError, ValueError, error.URLError): pass
    with app.run_lock(app.LOCAL / "ui-server"):
        dashboard = Dashboard()
        server = UiServer(("127.0.0.1", 0), dashboard)
        app.atomic_json(CONNECTION, {"url": server.origin, "pid": os.getpid()})
        app.log("充电助手界面已开启；查看界面不会预约或启动充电。")
        if args.open: webbrowser.open(server.origin)
        try: server.serve_forever(poll_interval=0.5)
        finally:
            dashboard.stop.set()
            server.server_close()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        app.log(f"界面启动未完成（{type(exc).__name__}）。")
        raise SystemExit(1)

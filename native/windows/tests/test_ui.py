import copy
import http.client
import json
import tempfile
import threading
import time
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

import neptune_charge as app
import ui_server as ui
from test_scheduler import CFG, FakeApi


class FakeBridge:
    def __init__(self, date, reservation):
        self.date, self.reservation = date, reservation
        self.calls = []
        self.entered = threading.Event()
        self.release = None
        self.task_data = {key: {"exists": True, "enabled": True, "matches_latest": True,
            "start_at": (date + timedelta(minutes=minutes)).isoformat()}
            for key, minutes in (("charge", 0), ("watch", 15))}

    def tasks(self):
        return copy.deepcopy(self.task_data)

    def invoke(self, mode):
        self.calls.append(mode)
        self.entered.set()
        if self.release is not None:
            self.release.wait(3)
        if mode == "Reserve":
            app.atomic_json(self.reservation, {"armed": True, "phase": "ready", "device": CFG["device"],
                "port": CFG["port"], "scheduled_at": self.date.isoformat(), "identity": "private-identity"})
            app.LATEST.write_text(str(self.reservation), encoding="utf-8")
        elif mode == "Cancel":
            state = json.loads(self.reservation.read_text(encoding="utf-8"))
            app.atomic_json(self.reservation, dict(state, armed=False, phase="cancelled"))
        else:
            raise AssertionError("UI must never run a charging command")


class DashboardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.now = datetime(2026, 10, 7, 9, tzinfo=app.CN)
        self.date = self.now.replace(hour=6) + timedelta(days=1)
        self.path = self.root / "reservations" / "20261008-60359118-06.json"
        self.patches = [patch.object(app, "LOCAL", self.root), patch.object(app, "LATEST", self.root / "latest.txt"),
                        patch.object(app, "LOG", self.root / "test.log"), patch.object(app, "now", return_value=self.now)]
        for p in self.patches: p.start()
        app.atomic_json(self.root / "email.json", {"enabled": True, "recipient": "test@example.org"})
        self.bridge = FakeBridge(self.date, self.path)
        self.dashboard = ui.Dashboard(bridge=self.bridge, cfg_loader=lambda: dict(CFG), background=False)
        self.dashboard.live = {"connected": True, "updated_at": self.now.isoformat(), "active_order": False,
                               "other_order": False, "balance_cents": 639, "power_watts": None}
        self.dashboard.tasks = self.bridge.tasks()
        self.server = ui.UiServer(("127.0.0.1", 0), self.dashboard)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        if self.bridge.release: self.bridge.release.set()
        self.wait_action()
        self.dashboard.stop.set()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        for p in reversed(self.patches): p.stop()
        self.temp.cleanup()

    def wait_action(self):
        for _ in range(100):
            if not self.dashboard.action["busy"]: return
            time.sleep(.01)
        self.fail("action did not finish")

    def body(self):
        return {"confirmedPlug": True, "device": CFG["device"], "port": CFG["port"], "expectedAt": self.date.isoformat()}

    def request(self, method, path, body=None, authenticated=True, origin=None, host=None):
        headers = {}
        if authenticated: headers["X-Neptune-Session"] = self.server.token
        if body is not None:
            headers["Content-Type"] = "application/json"
            headers["Origin"] = origin or self.server.origin
        if host: headers["Host"] = host
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        connection.request(method, path, json.dumps(body) if body is not None else None, headers)
        response = connection.getresponse()
        data = response.read()
        connection.close()
        return response.status, json.loads(data) if response.getheader("Content-Type", "").startswith("application/json") else data

    def test_reading_ui_does_not_reserve_and_private_fields_are_filtered(self):
        app.atomic_json(self.path, {"armed": False, "phase": "confirmed", "scheduled_at": self.date.isoformat(),
            "device": CFG["device"], "port": CFG["port"], "identity": "private-identity", "msgflag": "private-token",
            "payload": {"openId": CFG["open_id"]}})
        app.LATEST.write_text(str(self.path), encoding="utf-8")
        status, result = self.request("GET", "/api/state")
        self.assertEqual(status, 200)
        text = json.dumps(result)
        for secret in ("private-token", "private-identity", CFG["open_id"]): self.assertNotIn(secret, text)
        self.assertFalse(result["booked"])
        self.assertEqual(self.bridge.calls, [])

    def test_missing_session_wrong_host_and_foreign_origin_cannot_act(self):
        self.assertEqual(self.request("GET", "/api/state", authenticated=False)[0], 403)
        self.assertEqual(self.request("GET", "/api/state", host="evil.example")[0], 403)
        self.assertEqual(self.request("POST", "/api/reserve", self.body(), origin="https://evil.example")[0], 403)
        self.assertEqual(self.bridge.calls, [])

    def test_reserve_requires_plug_confirmation_correct_target_and_date(self):
        for field, value in (("confirmedPlug", False), ("device", "00000000"), ("expectedAt", "2026-10-09T06:00:00+08:00")):
            with self.subTest(field=field):
                self.assertEqual(self.request("POST", "/api/reserve", dict(self.body(), **{field: value}))[0], 409)
        self.assertEqual(self.bridge.calls, [])

    def test_reserve_reports_success_only_with_registered_tasks(self):
        self.assertEqual(self.request("POST", "/api/reserve", self.body())[0], 202)
        self.wait_action()
        result = self.dashboard.public_state()
        self.assertTrue(result["booked"])
        self.assertTrue(result["booking_healthy"])
        self.assertTrue(result["action"]["success"])
        self.assertEqual(self.bridge.calls, ["Reserve"])

    def test_partial_registration_is_not_reported_as_success(self):
        self.bridge.task_data["watch"] = {"exists": False}
        self.dashboard.begin_action("reserve", self.body())
        self.wait_action()
        self.assertFalse(self.dashboard.action["success"])
        self.assertIn("未全部登记", self.dashboard.action["message"])

    def test_busy_action_cannot_create_a_second_reservation(self):
        self.bridge.release = threading.Event()
        self.dashboard.begin_action("reserve", self.body())
        self.assertTrue(self.bridge.entered.wait(1))
        with self.assertRaises(app.ChargeError): self.dashboard.begin_action("reserve", self.body())
        self.bridge.release.set()
        self.wait_action()
        self.assertEqual(self.bridge.calls, ["Reserve"])

    def test_cancel_checks_booking_identity_and_execution_window(self):
        self.bridge.invoke("Reserve")
        with self.assertRaises(app.ChargeError): self.dashboard.begin_action("cancel", {"reservationId": "old.json"})
        state = json.loads(self.path.read_text(encoding="utf-8"))
        app.atomic_json(self.path, dict(state, phase="pending"))
        with self.assertRaises(app.ChargeError): self.dashboard.begin_action("cancel", {"reservationId": self.path.name})
        self.assertEqual(self.bridge.calls, ["Reserve"])

    def test_cancel_future_booking_and_keep_charge_command_unavailable(self):
        self.bridge.invoke("Reserve")
        self.dashboard.begin_action("cancel", {"reservationId": self.path.name})
        self.wait_action()
        self.assertEqual(self.bridge.calls, ["Reserve", "Cancel"])
        self.assertFalse(self.dashboard.public_state()["booked"])

    def test_wrong_task_time_and_expired_booking_are_not_valid(self):
        self.bridge.invoke("Reserve")
        self.dashboard.tasks["charge"]["start_at"] = (self.date + timedelta(hours=1)).isoformat()
        self.assertFalse(self.dashboard.public_state()["booking_healthy"])
        self.assertFalse(ui.current_booking({"armed": True, "phase": "ready", "scheduled_at": self.now.replace(hour=6).isoformat()}, self.now))

    def test_read_live_returns_metrics_without_account_or_order_details(self):
        api = FakeApi()
        api.order = {"devaddress": CFG["device"], "devport": CFG["port"], "power": 33,
                     "phoneNumber": "private-phone", "chargeSerialNo": "private-order"}
        with patch.object(app, "Api", return_value=api): result = ui.read_live(CFG)
        self.assertEqual(result["power_watts"], 33)
        self.assertTrue(result["active_order"])
        self.assertNotIn("private-phone", json.dumps(result))
        self.assertTrue(all(endpoint in app.READ_PATHS for endpoint, _ in api.calls))

    def test_static_paths_cannot_read_local_account_files(self):
        self.assertEqual(self.request("GET", "/.local/account.bin")[0], 404)
        self.assertEqual(self.request("GET", "/../../neptune_charge.py")[0], 404)


if __name__ == "__main__": unittest.main()

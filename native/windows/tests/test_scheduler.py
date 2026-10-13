import copy
import contextlib
import io
import json
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

import neptune_charge as app


CFG = {"open_id": "synthetic-account", "employee_id": 123, "area_id": 6,
       "device": "60359118", "port": "06",
       "prices": {"efee": 110, "eCharge": 55, "serviceCharge": 55,
                  "efee_l": 80, "eCharge_l": 80, "serviceCharge_l": 0}}
DEVICE = dict(CFG["prices"], devaddress="60359118", devtypeid=40, measure=1,
              isuse=1, countPay=1, yuan5=1, ycTime=480, yk=200,
              portstatur="000000000000", isWorkTime=1, safeCharge=9)
TARGET = {"devaddress": "60359118", "devport": "06"}


class FakeApi:
    def __init__(self, scenario="success"):
        self.scenario, self.calls = scenario, []
        self.submitted, self.acknowledged = False, False
        self.order = None
        self.device = copy.deepcopy(DEVICE)

    def call(self, endpoint, data):
        self.calls.append((endpoint, dict(data)))
        if endpoint == "getDeviceInfo":
            return {"success": True, "obj": self.device}
        if endpoint == "getUserInfo":
            return {"success": True, "obj": {"employeeid": 123, "readyaccountmoney": 639}}
        if endpoint == "getMsgs":
            return {"success": True, "obj": {"registrationCz": "1", "telphone": "00000000000"}}
        if endpoint == "isChargeing":
            order = self.order
            if self.submitted:
                order = TARGET
            return {"success": True, "obj": order}
        if endpoint != "beginCharge":
            raise AssertionError("Unexpected endpoint")
        if "msgflag" not in data:
            self.submitted = True
            if self.scenario == "lost-response":
                raise app.ChargeError("timeout")
            if self.scenario == "rejected":
                self.submitted = False
                return {"success": False, "msg": "设备离线"}
            return {"success": True, "obj": "same-request-token"}
        if self.scenario == "no-ack":
            return {"success": False, "msg": "设备无响应，请稍后再试！"}
        self.acknowledged = True
        return {"success": True, "obj": True}

    def new_submissions(self):
        return [data for endpoint, data in self.calls if endpoint == "beginCharge" and "msgflag" not in data]


class SchedulerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "reservation.json"
        self.date = datetime(2026, 10, 7, 6, tzinfo=app.CN)
        self.state = {"armed": True, "phase": "ready", "scheduled_at": self.date.isoformat(),
                      "identity": app.identity(CFG), "device": CFG["device"], "port": CFG["port"]}
        app.atomic_json(self.path, self.state)
        self.log_patch = patch.object(app, "LOG", Path(self.temp.name) / "logs" / "test.log")
        self.log_patch.start()
        self.mail_patch = patch.object(app, "notify_failure", return_value="quiet")
        self.mail_patch.start()
        self.quiet = contextlib.redirect_stdout(io.StringIO())
        self.quiet.__enter__()

    def tearDown(self):
        self.log_patch.stop()
        self.mail_patch.stop()
        self.quiet.__exit__(None, None, None)
        self.temp.cleanup()

    def runner(self, api, date=None):
        return app.Runner(api, CFG, self.path, clock=lambda: date or self.date, sleep=lambda _: None)

    def phase(self):
        return json.loads(self.path.read_text(encoding="utf-8"))["phase"]

    def test_exact_full_stop_payload_and_platform_ack(self):
        api = FakeApi()
        self.assertEqual(self.runner(api).execute(), 0)
        submissions = api.new_submissions()
        self.assertEqual(len(submissions), 1)
        self.assertEqual(submissions[0], {"devaddress": "60359118", "port": "06", "money": 7,
            "areaId": 6, "openId": "synthetic-account", "beforemoney": 639, "devtypeid": 40,
            "fullStop": 0, "payType": 1, "safeOpen": 0, "safeCharge": 9, "edtType": 0,
            "efee": 110, "eCharge": 55, "serviceCharge": 55, "yuan7": 0})
        self.assertEqual(self.phase(), "confirmed")
        self.assertNotIn("synthetic-account", self.path.read_text(encoding="utf-8"))
        self.assertEqual(self.runner(api).execute(), 0)
        self.assertEqual(len(api.new_submissions()), 1)

    def test_progress_display_cannot_overwrite_cancellation(self):
        runner = self.runner(FakeApi())
        cancelled = dict(self.state, armed=False, phase="cancelled")
        app.atomic_json(self.path, cancelled)
        runner.progress("checking", "正在核对。")
        self.assertEqual(json.loads(self.path.read_text(encoding="utf-8")), cancelled)
        progress = json.loads(self.path.with_suffix(".progress.json").read_text(encoding="utf-8"))
        self.assertEqual(progress["stage"], "checking")

    def test_lost_response_never_submits_twice_or_claims_confirmed(self):
        api = FakeApi("lost-response")
        self.assertEqual(self.runner(api).execute(), 1)
        self.assertEqual(len(api.new_submissions()), 1)
        self.assertEqual(self.phase(), "uncertain")
        self.runner(api).execute()
        self.assertEqual(len(api.new_submissions()), 1)

    def test_matching_order_without_power_ack_is_not_success(self):
        api = FakeApi("no-ack")
        self.assertEqual(self.runner(api).execute(), 1)
        self.assertEqual(self.phase(), "uncertain")
        self.assertEqual(len(api.new_submissions()), 1)
        self.assertTrue(all(d["msgflag"] == "same-request-token" for e, d in api.calls if e == "beginCharge" and "msgflag" in d))

    def test_existing_target_order_is_skipped(self):
        api = FakeApi()
        api.order = TARGET
        self.assertEqual(self.runner(api).execute(), 0)
        self.assertEqual(self.phase(), "already-charging")
        self.assertEqual(api.new_submissions(), [])

    def test_other_order_occupied_port_and_changed_cost_stop(self):
        for change in ("other-order", "occupied", "price", "prepay", "package"):
            with self.subTest(change=change):
                app.atomic_json(self.path, self.state)
                api = FakeApi()
                if change == "other-order": api.order = dict(TARGET, devport="05")
                if change == "occupied": api.device["portstatur"] = "000001000000"
                if change == "price": api.device["efee"] = 120
                if change == "prepay": api.device["yk"] = 300
                if change == "package": api.device["ycTime"] = 600
                self.assertEqual(self.runner(api).execute(), 1)
                self.assertEqual(api.new_submissions(), [])

    def test_outside_window_cannot_charge(self):
        for date in (self.date - timedelta(seconds=1), self.date + timedelta(hours=3)):
            app.atomic_json(self.path, self.state)
            api = FakeApi()
            self.assertEqual(self.runner(api, date).execute(), 1)
            self.assertEqual(api.calls, [])

    def test_pre_submit_crash_state_only_reconciles(self):
        state = dict(self.state, phase="submitting", payload={k: v for k, v in app.payload(CFG, DEVICE, {"readyaccountmoney": 639}).items() if k != "openId"})
        app.atomic_json(self.path, state)
        api = FakeApi()
        self.assertEqual(self.runner(api).execute(), 1)
        self.assertEqual(api.new_submissions(), [])

    def test_pending_restart_reuses_only_original_token(self):
        state = dict(self.state, phase="pending", msgflag="same-request-token", payload={k: v for k, v in app.payload(CFG, DEVICE, {"readyaccountmoney": 639}).items() if k != "openId"})
        app.atomic_json(self.path, state)
        api = FakeApi()
        api.submitted = True
        self.assertEqual(self.runner(api).execute(), 0)
        self.assertEqual(api.new_submissions(), [])
        self.assertEqual(self.phase(), "confirmed")

    def test_rejected_submission_is_consumed(self):
        api = FakeApi("rejected")
        self.assertEqual(self.runner(api).execute(), 1)
        self.assertEqual(self.phase(), "rejected")
        self.runner(api).execute()
        self.assertEqual(len(api.new_submissions()), 1)

    def test_only_read_paths_allowed_in_check(self):
        with self.assertRaises(app.ChargeError):
            app.Api().call("beginCharge", {})

    def test_windows_credential_encryption_roundtrip(self):
        protected = app.dpapi(b"synthetic-secret")
        self.assertNotIn(b"synthetic-secret", protected)
        self.assertEqual(app.dpapi(protected, decrypt=True), b"synthetic-secret")

    def test_lock_blocks_same_reservation(self):
        with app.run_lock(self.path):
            with self.assertRaises(app.ChargeError):
                with app.run_lock(self.path):
                    self.fail("Second execution acquired the lock")

    def test_closed_hours_wait_then_open_without_early_start(self):
        api = FakeApi()
        api.device["isWorkTime"] = 0
        current = [self.date]

        def sleep(seconds):
            current[0] += timedelta(seconds=seconds)
            if current[0] >= self.date + timedelta(seconds=15):
                api.device["isWorkTime"] = 1

        runner = app.Runner(api, CFG, self.path, clock=lambda: current[0], sleep=sleep)
        self.assertEqual(runner.execute(), 0)
        self.assertEqual(len(api.new_submissions()), 1)
        self.assertGreaterEqual(datetime.fromisoformat(runner.state["submitted_at"]), self.date + timedelta(seconds=45))

    def test_closed_hours_expire_without_any_submission(self):
        api = FakeApi()
        api.device["isWorkTime"] = 0
        current = [self.date]
        runner = app.Runner(api, CFG, self.path, clock=lambda: current[0],
                            sleep=lambda seconds: current.__setitem__(0, current[0] + timedelta(seconds=seconds)))
        self.assertEqual(runner.execute(), 1)
        self.assertEqual(api.new_submissions(), [])

    def test_snapshot_delays_past_deadline_cannot_submit(self):
        api = FakeApi()
        current = [self.date]
        original = api.call

        def delayed(endpoint, data):
            if endpoint == "getUserInfo":
                current[0] += timedelta(minutes=11)
            return original(endpoint, data)

        api.call = delayed
        runner = app.Runner(api, CFG, self.path, clock=lambda: current[0], sleep=lambda _: None)
        self.assertEqual(runner.execute(), 1)
        self.assertEqual(api.new_submissions(), [])

    def test_cancel_during_boot_wait_cannot_submit(self):
        api = FakeApi()

        def cancel(_):
            state = json.loads(self.path.read_text(encoding="utf-8"))
            state["armed"] = False
            app.atomic_json(self.path, state)

        runner = app.Runner(api, CFG, self.path, clock=lambda: self.date, sleep=cancel)
        self.assertEqual(runner.execute(), 1)
        self.assertEqual(self.phase(), "cancelled")
        self.assertEqual(api.new_submissions(), [])


if __name__ == "__main__":
    unittest.main()

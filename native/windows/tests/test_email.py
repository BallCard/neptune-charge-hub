import contextlib
import io
import json
import smtplib
import subprocess
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

import failure_email as mail
import mail_worker as worker


class FakeSmtp:
    def __init__(self, error=None, quit_error=False):
        self.error, self.quit_error = error, quit_error
        self.sent = []

    def login(self, account, auth):
        pass

    def send_message(self, message):
        self.sent.append(message)
        if self.error:
            raise self.error
        return {}

    def quit(self):
        if self.quit_error:
            raise ConnectionError("quit failed after acceptance")

    def close(self):
        pass


class EmailTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.config = {"enabled": True, "python": "test-python", "sender": "test@example.org",
                       "recipient": "test@example.org", "keyring_service": "test-vault"}
        self.patches = [patch.object(mail, "CONFIG", self.root / "email.json"),
                        patch.object(mail, "OUTBOX", self.root / "outbox"),
                        patch.object(mail, "LOG", self.root / "email.log"),
                        patch.object(worker, "password", return_value="synthetic-code")]
        for p in self.patches:
            p.start()
        self.output = contextlib.redirect_stdout(io.StringIO())
        self.output.__enter__()
        mail.write_json(mail.CONFIG, self.config)
        self.reservation = self.root / "20261007-60359118-06.json"
        self.date = datetime(2026, 10, 7, 6, tzinfo=mail.CN)
        self.state = {"phase": "failed", "scheduled_at": self.date.isoformat(),
                      "device": "60359118", "port": "06", "result": "设备离线"}
        self.smtp = FakeSmtp()

    def tearDown(self):
        self.output.__exit__(None, None, None)
        for p in reversed(self.patches):
            p.stop()
        self.temp.cleanup()

    def fake_process(self, args, **kwargs):
        path = Path(args[args.index("--job") + 1])
        worker.send(path, self.config, smtp_factory=lambda *a, **k: self.smtp)
        return subprocess.CompletedProcess(args, 0)

    def test_failure_delivered_once_and_watchdog_deduplicates(self):
        mail.write_json(self.reservation, self.state)
        with patch.object(mail.subprocess, "run", side_effect=self.fake_process) as process:
            self.assertEqual(mail.notify_failure(self.reservation, self.state), "sent")
            self.assertEqual(mail.watch(self.reservation, self.date.isoformat(),
                                       clock=lambda: self.date + timedelta(minutes=15)), "sent")
            self.assertEqual(process.call_count, 1)
        self.assertEqual(len(self.smtp.sent), 1)
        self.assertIn("设备离线", self.smtp.sent[0].get_content())
        self.assertEqual(self.smtp.sent[0]["To"], "test@example.org")

    def test_success_cancel_and_early_watch_are_quiet(self):
        with patch.object(mail.subprocess, "run") as process:
            for phase in mail.QUIET:
                state = dict(self.state, phase=phase)
                mail.write_json(self.reservation, state)
                self.assertEqual(mail.notify_failure(self.reservation, state), "quiet")
                self.assertEqual(mail.watch(self.reservation, self.date.isoformat(),
                    clock=lambda: self.date + timedelta(minutes=15)), "quiet")
            self.assertEqual(mail.watch(self.reservation, self.date.isoformat(),
                clock=lambda: self.date + timedelta(minutes=14)), "quiet")
            process.assert_not_called()

    def test_watch_reports_missing_crashed_and_unrun_job(self):
        for phase in (None, "ready", "submitting", "pending"):
            with self.subTest(phase=phase):
                if phase is not None:
                    mail.write_json(self.reservation, dict(self.state, phase=phase))
                with patch.object(mail, "notify_failure", return_value="sent") as notify:
                    self.assertEqual(mail.watch(self.reservation, self.date.isoformat(),
                        clock=lambda: self.date + timedelta(minutes=15)), "sent")
                    self.assertEqual(notify.call_args.args[1]["phase"], "failed")

    def test_watch_ignores_replaced_booking(self):
        mail.write_json(self.reservation, dict(self.state,
            scheduled_at=(self.date + timedelta(days=1)).isoformat()))
        with patch.object(mail, "notify_failure") as notify:
            self.assertEqual(mail.watch(self.reservation, self.date.isoformat(),
                clock=lambda: self.date + timedelta(minutes=15)), "quiet")
            notify.assert_not_called()

    def test_watch_matches_same_instant_with_different_iso_format(self):
        mail.write_json(self.reservation, self.state)
        with patch.object(mail, "notify_failure", return_value="sent") as notify:
            self.assertEqual(mail.watch(self.reservation, "2026-10-06T22:00:00+00:00",
                clock=lambda: self.date + timedelta(minutes=15)), "sent")
            notify.assert_called_once()

    def test_watch_rejects_missing_timezone(self):
        with self.assertRaises(ValueError):
            mail.watch(self.reservation, "2026-10-07T06:00:00",
                       clock=lambda: self.date + timedelta(minutes=15))

    def test_pre_send_failures_retry_at_most_three_times(self):
        with patch.object(mail.subprocess, "run", side_effect=FileNotFoundError("missing-runtime")) as process:
            for _ in range(5):
                self.assertEqual(mail.notify_failure(self.reservation, self.state), "failed")
            self.assertEqual(process.call_count, 3)

    def test_uncertain_smtp_acceptance_is_not_retried(self):
        self.smtp = FakeSmtp(error=ConnectionError("response lost during DATA"))
        with patch.object(mail.subprocess, "run", side_effect=self.fake_process) as process:
            self.assertEqual(mail.notify_failure(self.reservation, self.state), "uncertain")
            self.assertEqual(mail.notify_failure(self.reservation, self.state), "uncertain")
            self.assertEqual(process.call_count, 1)

    def test_explicit_smtp_rejection_is_retryable(self):
        self.smtp = FakeSmtp(error=smtplib.SMTPDataError(451, b"temporary error"))
        with patch.object(mail.subprocess, "run", side_effect=self.fake_process):
            self.assertEqual(mail.notify_failure(self.reservation, self.state), "failed")
            self.smtp = FakeSmtp()
            self.assertEqual(mail.notify_failure(self.reservation, self.state), "sent")

    def test_quit_error_after_acceptance_is_still_sent(self):
        self.smtp = FakeSmtp(quit_error=True)
        with patch.object(mail.subprocess, "run", side_effect=self.fake_process):
            self.assertEqual(mail.notify_failure(self.reservation, self.state), "sent")

    def test_process_timeout_during_data_is_not_retried(self):
        def timeout(args, **kwargs):
            path = Path(args[args.index("--job") + 1])
            job = json.loads(path.read_text(encoding="utf-8"))
            mail.write_json(path, dict(job, phase="sending", attempts=1))
            raise subprocess.TimeoutExpired(args, 55)
        with patch.object(mail.subprocess, "run", side_effect=timeout) as process:
            self.assertEqual(mail.notify_failure(self.reservation, self.state), "uncertain")
            self.assertEqual(mail.notify_failure(self.reservation, self.state), "uncertain")
            self.assertEqual(process.call_count, 1)

    def test_disabled_notification_does_not_spawn_mail_process(self):
        mail.write_json(mail.CONFIG, dict(self.config, enabled=False))
        with patch.object(mail.subprocess, "run") as process:
            self.assertEqual(mail.notify_failure(self.reservation, self.state), "quiet")
            process.assert_not_called()


if __name__ == "__main__":
    unittest.main()

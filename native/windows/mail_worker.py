"""SMTP worker: reuse the owner's existing Windows-vault QQ authorization code."""
from __future__ import annotations

import argparse
import email
import imaplib
import json
import os
import smtplib
import ssl
from datetime import datetime, timedelta, timezone
from email.header import decode_header, make_header
from email.message import EmailMessage
from email.utils import formatdate, parsedate_to_datetime
from pathlib import Path


def write_job(path, job):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(job, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temporary, path)


def password(config):
    import keyring
    value = keyring.get_password(config["keyring_service"], config["sender"])
    if not value:
        raise RuntimeError("Stored QQ authorization code is unavailable")
    return value


def send(path, config, smtp_factory=smtplib.SMTP_SSL):
    job = json.loads(path.read_text(encoding="utf-8"))
    if job.get("phase") in {"sent", "sending", "uncertain"} or job.get("attempts", 0) >= 3:
        return job.get("phase")
    job.update(phase="connecting", attempts=job.get("attempts", 0) + 1,
               last_attempt_at=datetime.now(timezone.utc).isoformat())
    write_job(path, job)
    smtp = None
    try:
        message = EmailMessage()
        message["From"] = config["sender"]
        message["To"] = config["recipient"]
        message["Subject"] = job["subject"]
        message["Date"] = formatdate(localtime=True)
        message["Message-ID"] = job["message_id"]
        message["X-Neptune-Notification-ID"] = job["message_id"]
        message.set_content(job["body"])
        auth = password(config)
        smtp = smtp_factory("smtp.qq.com", 465, timeout=15, context=ssl.create_default_context())
        smtp.login(config["sender"], auth)
        job["phase"] = "sending"
        write_job(path, job)  # A crash in DATA means uncertain acceptance; do not resend.
        refused = smtp.send_message(message)
        if refused:
            raise smtplib.SMTPRecipientsRefused(refused)
        job.update(phase="sent", accepted_at=datetime.now(timezone.utc).isoformat(), error=None)
        write_job(path, job)
    except Exception as exc:
        definite_rejection = isinstance(exc, (smtplib.SMTPRecipientsRefused,
            smtplib.SMTPSenderRefused, smtplib.SMTPDataError))
        job.update(phase="failed" if job["phase"] == "connecting" or definite_rejection else "uncertain",
                   error=f"邮件发送异常（{type(exc).__name__}）；未记录凭据或服务器响应。")
        write_job(path, job)
    finally:
        if smtp is not None:
            try:
                smtp.quit()
            except Exception:
                smtp.close()
    return job["phase"]


def confirm_delivery(path, config):
    """Read-only receipt check; QQ rewrites Message-ID, so fall back to matching test headers."""
    job = json.loads(path.read_text(encoding="utf-8"))
    with imaplib.IMAP4_SSL("imap.qq.com", 993, timeout=15, ssl_context=ssl.create_default_context()) as mailbox:
        mailbox.login(config["sender"], password(config))
        status, _ = mailbox.select("INBOX", readonly=True)
        if status != "OK":
            return False
        status, values = mailbox.search(None, "HEADER", "Message-ID", job["message_id"])
        if status == "OK" and values and values[0]:
            return True
        status, values = mailbox.search(None, "HEADER", "X-Neptune-Notification-ID", job["message_id"])
        if status == "OK" and values and values[0]:
            return True
        # Only inspect headers of up to eight recent messages from the owner's account.
        attempted = datetime.fromisoformat(job.get("last_attempt_at", job["created_at"]))
        since = attempted.strftime("%d-%b-%Y")
        status, values = mailbox.search(None, "FROM", config["sender"], "SINCE", since)
        for uid in (values[0].split() if status == "OK" and values else [])[-8:]:
            status, raw = mailbox.fetch(uid, "(BODY.PEEK[HEADER.FIELDS (SUBJECT TO DATE)])")
            if status != "OK":
                continue
            message = email.message_from_bytes(b"".join(x[1] for x in raw if isinstance(x, tuple)))
            if str(make_header(decode_header(message.get("Subject", "")))) != job["subject"]:
                continue
            if config["recipient"] not in message.get("To", ""):
                continue
            try:
                date = parsedate_to_datetime(message["Date"])
                if attempted - timedelta(minutes=2) <= date <= attempted + timedelta(minutes=2):
                    return True
            except (ValueError, TypeError):
                continue
        return False


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("send", "confirm-delivery"))
    parser.add_argument("--job", type=Path, required=True)
    parser.add_argument("--config", type=Path, required=True)
    args = parser.parse_args()
    config = json.loads(args.config.read_text(encoding="utf-8"))
    if args.command == "confirm-delivery":
        delivered = confirm_delivery(args.job, config)
        print(json.dumps({"inbox_confirmed": delivered}))
        return 0 if delivered else 1
    phase = send(args.job, config)
    print(json.dumps({"phase": phase}))
    return 0 if phase == "sent" else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({"error_type": type(exc).__name__}))
        raise SystemExit(1)

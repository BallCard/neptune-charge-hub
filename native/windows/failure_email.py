"""Failure-only email, independent of the charging API and charging run lock."""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LOCAL = ROOT / ".local"
CONFIG = LOCAL / "email.json"
OUTBOX = LOCAL / "notifications"
LOG = ROOT / "logs" / "latest.log"
CN = timezone(timedelta(hours=8))
FAILURES = {"failed", "rejected", "uncertain", "expired"}
QUIET = {"confirmed", "already-charging", "cancelled"}


def now():
    return datetime.now(CN)


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temporary, path)


def log(message):
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with LOG.open("a", encoding="utf-8") as file:
        file.write(f"{now():%Y-%m-%d %H:%M:%S}  {message}\n")
    if sys.stdout is not None:
        print(message, flush=True)


@contextlib.contextmanager
def mail_lock(path):
    import msvcrt
    with path.with_suffix(".lock").open("a+b") as file:
        file.write(b"0")
        file.flush()
        file.seek(0)
        msvcrt.locking(file.fileno(), msvcrt.LK_NBLCK, 1)
        try:
            yield
        finally:
            file.seek(0)
            msvcrt.locking(file.fileno(), msvcrt.LK_UNLCK, 1)


def deliver(path, config):
    """Retries only a known failure before email acceptance, never a charging request."""
    with mail_lock(path):
        job = json.loads(path.read_text(encoding="utf-8"))
        if job.get("phase") in {"sent", "uncertain", "sending"}:
            return job["phase"]
        if job.get("attempts", 0) >= 3:
            return "failed"
        before_attempts = job.get("attempts", 0)
        # Separate runtime contains the already-installed Windows keyring package.
        try:
            subprocess.run([config["python"], str(ROOT / "mail_worker.py"), "send",
                            "--job", str(path), "--config", str(CONFIG)],
                           check=False, timeout=55, capture_output=True,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        except Exception as exc:
            job = json.loads(path.read_text(encoding="utf-8"))
            if job.get("phase") == "sending":
                job.update(phase="uncertain", error="发送时中断，投递结果不明；为避免重复邮件，不重发。")
            elif job.get("phase") != "sent":
                job.update(phase="failed", attempts=max(job.get("attempts", 0), before_attempts + 1),
                           error=f"邮件进程未完成（{type(exc).__name__}）。")
            write_json(path, job)
        job = json.loads(path.read_text(encoding="utf-8"))
        if job.get("phase") in {"prepared", "connecting", "sending"}:
            job.update(phase="uncertain" if job["phase"] == "sending" else "failed",
                       attempts=max(job.get("attempts", 0), before_attempts + 1),
                       error="邮件进程退出时没有明确的投递结果。")
            write_json(path, job)
        phase = job.get("phase", "failed")
        if phase == "sent":
            log(f"充电提醒邮件已交给 QQ 邮箱服务器：{config['recipient']}。")
        else:
            log(f"充电提醒邮件尚未确认投递（{phase}），详情在本机通知记录。")
        return phase


def notice_path(reservation):
    suffix = hashlib.sha256(str(reservation.resolve()).encode()).hexdigest()[:12]
    return OUTBOX / f"{reservation.stem}-{suffix}.json"


def notify_failure(reservation, state):
    """Best effort: notification failure must never alter charging or resubmit payment."""
    try:
        if state.get("phase") not in FAILURES or not CONFIG.exists():
            return "quiet"
        config = json.loads(CONFIG.read_text(encoding="utf-8"))
        if not config.get("enabled"):
            return "quiet"
        path = notice_path(reservation)
        path.parent.mkdir(parents=True, exist_ok=True)
        # The parent charging process and watchdog may race. Serialize creation too.
        with mail_lock(path.with_name(path.stem + "-create.json")):
            if not path.exists():
                scheduled = datetime.fromisoformat(state["scheduled_at"]).astimezone(CN)
                body = (
                    f"预约时间：{scheduled:%Y年%m月%d日 %H:%M}（北京时间）\n"
                    f"设备：{state['device']}，插座：{state['port']}（玉泉原电工厂）\n"
                    "套餐：充满自停，单次最长480分钟，账户余额支付。\n\n"
                    f"结果：{state.get('result', '未能确认启动。')}\n\n"
                    "请在微信打开尼普顿，查看充电订单及插座状态。结果不明时，"
                    "先确认是否已在充电，再决定手动启动，避免重复扣费。\n"
                    "这封邮件只报告平台启动检查结果，无法测量电池电量。\n"
                    "电脑没有自动重复新建充电请求。\n"
                )
                write_json(path, {"phase": "prepared", "attempts": 0,
                    "subject": f"【充电提醒】{scheduled:%m月%d日}早晨充电未能确认启动",
                    "body": body, "message_id": f"<neptune-{path.stem}@qq.com>",
                    "reservation": str(reservation), "created_at": now().isoformat()})
        return deliver(path, config)
    except Exception as exc:
        try:
            log(f"邮件提醒检查异常（{type(exc).__name__}），请查看充电日志。")
        except Exception:
            pass
        return "failed"


def watch(reservation, scheduled_at, clock=now):
    """06:15 check can report a missing/crashed main process without starting charging."""
    scheduled = datetime.fromisoformat(scheduled_at)
    if scheduled.tzinfo is None:
        raise ValueError("Schedule must contain a UTC offset")
    if clock() < scheduled + timedelta(minutes=15):
        return "quiet"
    try:
        state = json.loads(reservation.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        parts = reservation.stem.split("-")
        state = {"scheduled_at": scheduled_at, "device": parts[1], "port": parts[2],
                 "phase": "failed", "result": "预约结果文件缺失或损坏，未能确认启动。"}
    try:
        if datetime.fromisoformat(state["scheduled_at"]) != scheduled:
            return "quiet"  # Old watchdog must not report a newer booking.
    except (ValueError, TypeError, KeyError):
        state = dict(state, scheduled_at=scheduled_at, phase="failed",
                     result="预约日期记录损坏，未能确认启动。")
    if state.get("phase") in QUIET:
        return "quiet"
    if state.get("phase") not in FAILURES:
        state = dict(state, phase="failed",
            result="截至6:15，电脑未记录完成的启动结果，可能未执行或运行中断。")
    return notify_failure(reservation, state)


def send_test(test_id):
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    if not test_id.isalnum():
        raise ValueError("Test identifier must be alphanumeric")
    path = OUTBOX / f"test-{test_id}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        write_json(path, {"phase": "prepared", "attempts": 0,
            "subject": "【测试邮件】尼普顿早晨充电失败提醒已配置",
            "body": "这是邮件通道测试，不代表实际充电失败，也没有启动充电。\n\n"
                    "若预约的早晨充电失败或结果不明，电脑会立即发提醒；6:15还会检查是否漏跑。\n"
                    "请打开手机QQ邮箱的邮件通知。电脑关机或断网时，邮件也可能无法及时发出。\n",
            "message_id": f"<neptune-test-{test_id}@qq.com>", "created_at": now().isoformat()})
    return deliver(path, config)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("watch", "test"))
    parser.add_argument("--reservation", type=Path)
    parser.add_argument("--scheduled-at")
    parser.add_argument("--test-id")
    args = parser.parse_args()
    if args.command == "test":
        return 0 if send_test(args.test_id) == "sent" else 1
    if not args.reservation or args.reservation.resolve().parent != (LOCAL / "reservations").resolve():
        raise ValueError("Reservation path is outside this tool")
    result = watch(args.reservation, args.scheduled_at)
    if result == "quiet":
        log("备用邮件检查完成：本次无需发送失败提醒。")
    return 0 if result in {"quiet", "sent"} else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        log(f"邮件检查未完成（{type(exc).__name__}）。")
        sys.exit(1)

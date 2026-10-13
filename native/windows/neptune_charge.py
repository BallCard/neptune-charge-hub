"""Personal, single-morning Neptune balance charging. Python standard library only."""
from __future__ import annotations

import argparse
import contextlib
import ctypes
import hashlib
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib import error, parse, request

from failure_email import notify_failure

ROOT = Path(__file__).resolve().parent
LOCAL = ROOT / ".local"
ACCOUNT = LOCAL / "account.bin"
LATEST = LOCAL / "latest-reservation.txt"
LOG = ROOT / "logs" / "latest.log"
CN = timezone(timedelta(hours=8))
BASE = "https://www.szlzxn.cn"
READ_PATHS = {"getDeviceInfo", "getUserInfo", "getMsgs", "isChargeing"}
PRICE_FIELDS = ("efee", "eCharge", "serviceCharge", "efee_l", "eCharge_l", "serviceCharge_l")


class ChargeError(Exception):
    pass


class NetworkError(ChargeError):
    pass


def now():
    return datetime.now(CN)


def log(message):
    LOG.parent.mkdir(exist_ok=True)
    line = f"{now():%Y-%m-%d %H:%M:%S}  {message}"
    with LOG.open("a", encoding="utf-8") as f:
        f.write(line + "\n")
    if sys.stdout is not None:
        print(line, flush=True)


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temporary, path)


def dpapi(data, decrypt=False):
    """Encrypt for the current Windows user; no plaintext account file is written."""
    if os.name != "nt":
        raise ChargeError("账号保存需要 Windows。")

    class Blob(ctypes.Structure):
        _fields_ = [("size", ctypes.c_uint32), ("data", ctypes.POINTER(ctypes.c_ubyte))]

    buffer = ctypes.create_string_buffer(data)
    source = Blob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
    result = Blob()
    crypt = ctypes.WinDLL("crypt32", use_last_error=True)
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    function = crypt.CryptUnprotectData if decrypt else crypt.CryptProtectData
    function.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p,
                         ctypes.c_void_p, ctypes.c_void_p, ctypes.c_uint32, ctypes.POINTER(Blob)]
    function.restype = ctypes.c_int
    if not function(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(result)):
        raise ChargeError("无法保存或读取本 Windows 用户的加密账号。")
    try:
        return ctypes.string_at(result.data, result.size)
    finally:
        kernel.LocalFree(ctypes.cast(result.data, ctypes.c_void_p))


def load_account():
    if not ACCOUNT.exists():
        raise ChargeError("尚未导入付款页链接，请先运行 setup。")
    return json.loads(dpapi(ACCOUNT.read_bytes(), decrypt=True))


def identity(cfg):
    return hashlib.sha256((cfg["open_id"] + ":" + str(cfg["employee_id"])).encode()).hexdigest()


class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ChargeError("平台接口发生重定向，已停止操作。")


class Api:
    def __init__(self, allow_charge=False):
        self.allow_charge = allow_charge

    def call(self, endpoint, data):
        if endpoint not in READ_PATHS and not (endpoint == "beginCharge" and self.allow_charge):
            raise ChargeError("只读检查不能提交充电。")
        req = request.Request(BASE + "/wxn/" + endpoint,
                              data=parse.urlencode(data).encode("utf-8"),
                              headers={"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"})
        try:
            with request.build_opener(NoRedirect).open(req, timeout=10) as response:
                result = json.loads(response.read(1_000_000).decode("utf-8"))
        except (error.URLError, TimeoutError, OSError) as exc:
            raise NetworkError(f"平台请求失败（{type(exc).__name__}），接口：{endpoint}") from None
        except ValueError:
            raise ChargeError("平台返回格式发生变化。") from None
        if not isinstance(result, dict):
            raise ChargeError("平台返回格式发生变化。")
        return result


def object_response(result, label):
    if result.get("success") is not True or not isinstance(result.get("obj"), dict):
        raise ChargeError(f"{label}查询失败，停止操作。")
    return result["obj"]


def active_order(api, cfg):
    result = api.call("isChargeing", {"openId": cfg["open_id"], "areaId": cfg["area_id"]})
    if result.get("success") is not True:
        raise ChargeError("本人充电订单查询失败，停止操作。")
    obj = result.get("obj")
    if obj is not None and not isinstance(obj, dict):
        raise ChargeError("本人订单格式发生变化，停止操作。")
    return obj


def matching(order, cfg):
    try:
        return bool(order) and str(order.get("devaddress")) == cfg["device"] and int(order.get("devport")) == int(cfg["port"])
    except (ValueError, TypeError):
        return False


def snapshot(api, cfg):
    calls = [
        ("getDeviceInfo", {"areaId": cfg["area_id"], "devaddress": cfg["device"]}),
        ("getUserInfo", {"openId": cfg["open_id"], "areaId": cfg["area_id"]}),
        ("getMsgs", {"employeeid": cfg["employee_id"], "areaid": cfg["area_id"]}),
    ]
    with ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(lambda item: api.call(*item), calls))
    device, user, messages = [object_response(r, label) for r, label in zip(results, ("设备", "账户", "实名状态"))]
    order = active_order(api, cfg)
    if str(device.get("devaddress")) != cfg["device"] or str(user.get("employeeid")) != str(cfg["employee_id"]):
        raise ChargeError("设备或本人账号核对失败。")
    if str(messages.get("registrationCz")) == "1" and len(str(messages.get("telphone") or "")) != 11:
        raise ChargeError("平台要求先绑定手机号，请在微信完成。")
    try:
        if any(int(device.get(key, -1)) != val for key, val in
               {"devtypeid": 40, "measure": 1, "isuse": 1, "countPay": 1, "yuan5": 1, "ycTime": 480}.items()):
            raise ChargeError("设备、付款方式或套餐已改变，需要重新核对。")
        prepay = int(device["yk"])
        balance = int(user["readyaccountmoney"])
        if not 0 < prepay <= 200:
            raise ChargeError("预扣金额超过2元或格式异常，停止操作。")
        if balance < max(200, prepay):
            raise ChargeError("账户余额不足2元，请在微信充值。")
        if any(int(device.get(k, -1)) != v for k, v in cfg["prices"].items()):
            raise ChargeError("收费标准已改变，需要重新导入并核对。")
        ports = str(device["portstatur"])
        port = int(cfg["port"])
        if not 1 <= port <= len(ports):
            raise ChargeError("插座号不在设备范围内。")
        if order and not matching(order, cfg):
            raise ChargeError("本人在其他插座已有订单，停止新建充电。")
        if not order and ports[port - 1] != "0":
            raise ChargeError("目标插座已被占用、故障或状态未知，停止操作。")
    except (ValueError, TypeError, KeyError):
        raise ChargeError("设备或金额字段异常，停止操作。") from None
    return device, user, order


def payload(cfg, device, user):
    # Same branch as the official payment page: metered charging, full-stop meal,
    # balance payment. money=7 and yuan7=0 are protocol mode values, not yuan/minutes.
    return {"devaddress": cfg["device"], "port": cfg["port"], "money": 7,
            "areaId": cfg["area_id"], "openId": cfg["open_id"],
            "beforemoney": int(user["readyaccountmoney"]), "devtypeid": int(device["devtypeid"]),
            "fullStop": 0, "payType": 1, "safeOpen": 0, "safeCharge": device["safeCharge"],
            "edtType": 0, "efee": device["efee"], "eCharge": device["eCharge"],
            "serviceCharge": device["serviceCharge"], "yuan7": 0}


def setup(url):
    parsed = parse.urlsplit(url)
    if parsed.scheme not in ("http", "https") or parsed.hostname not in ("www.szlzxn.cn", "szlzxn.cn") or parsed.path != "/wx/indexn.html":
        raise ChargeError("请使用尼普顿付款页复制出的完整链接。")
    query = parse.parse_qs(parsed.query)
    fragment = parse.parse_qs(parsed.fragment.partition("?")[2])
    try:
        raw_device = query["devaddress"][0]
        port = fragment["socketNumber"][0].zfill(2)
        if len(raw_device) != 10 or not raw_device.isdigit() or raw_device[-2:] != port:
            raise ChargeError("链接中的设备与插座号不一致。")
        cfg = {"open_id": query["openId"][0], "employee_id": int(query["employeeId"][0]),
               "area_id": int(query["areaid"][0]), "device": raw_device[:-2], "port": port,
               "prices": {}}
        if not cfg["open_id"] or cfg["employee_id"] <= 0 or cfg["area_id"] <= 0:
            raise ChargeError("账号信息不完整。")
    except (KeyError, ValueError):
        raise ChargeError("付款页链接不完整。") from None
    api = Api()
    device = object_response(api.call("getDeviceInfo", {"areaId": cfg["area_id"], "devaddress": cfg["device"]}), "设备")
    cfg["prices"] = {key: int(device[key]) for key in PRICE_FIELDS}
    snapshot(api, cfg)
    LOCAL.mkdir(parents=True, exist_ok=True)
    ACCOUNT.write_bytes(dpapi(json.dumps(cfg).encode()))
    log(f"账号已核对并加密保存；设备 {cfg['device']}，插座 {cfg['port']}，充满自停最长480分钟。")


def next_morning(clock=None):
    current = clock or now()
    target = current.replace(hour=6, minute=0, second=0, microsecond=0)
    if target <= current:
        target += timedelta(days=1)
    return target


def reserve(cfg):
    target = next_morning()
    state = {"armed": True, "phase": "ready", "scheduled_at": target.isoformat(),
             "device": cfg["device"], "port": cfg["port"], "identity": identity(cfg)}
    path = LOCAL / "reservations" / (target.strftime("%Y%m%d") + f"-{cfg['device']}-{cfg['port']}.json")
    if path.exists() and json.loads(path.read_text(encoding="utf-8")).get("phase") not in ("ready", "cancelled"):
        raise ChargeError("这个早晨已经尝试过启动，不允许重复预约。")
    atomic_json(path, state)
    LATEST.write_text(str(path), encoding="utf-8")
    return path


@contextlib.contextmanager
def run_lock(path):
    import msvcrt
    with path.with_suffix(".lock").open("a+b") as file:
        file.write(b"0")
        file.flush()
        file.seek(0)
        try:
            msvcrt.locking(file.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            raise ChargeError("另一个进程正在执行同一预约。") from None
        try:
            yield
        finally:
            file.seek(0)
            msvcrt.locking(file.fileno(), msvcrt.LK_UNLCK, 1)


class Runner:
    def __init__(self, api, cfg, path, clock=now, sleep=time.sleep):
        self.api, self.cfg, self.path = api, cfg, path
        self.clock, self.sleep = clock, sleep
        self.state = json.loads(path.read_text(encoding="utf-8"))

    def save(self):
        atomic_json(self.path, self.state)

    def progress(self, stage, message):
        # Separate file: displaying progress cannot overwrite cancellation/payment state.
        path = self.path.with_suffix(".progress.json")
        try:
            events = json.loads(path.read_text(encoding="utf-8")).get("events", []) if path.exists() else []
            if not events or events[-1]["stage"] != stage:
                events.append({"stage": stage, "message": message, "at": self.clock().isoformat()})
            atomic_json(path, {"stage": stage, "message": message, "updated_at": self.clock().isoformat(), "events": events[-16:]})
        except Exception:
            pass  # A UI progress failure must not change the actual charging flow.

    def finish(self, phase, message):
        self.state.update(armed=False, phase=phase, result=message, finished_at=self.clock().isoformat())
        self.save()
        self.progress(phase, message)
        log(message)
        notify_failure(self.path, self.state)
        return 0 if phase in ("confirmed", "already-charging") else 1

    def verify(self, data, flag):
        self.progress("confirming", "正在核对开电结果与本人的订单。")
        acknowledged = bool(self.state.get("acknowledged"))
        for attempt in range(15):
            self.sleep(6)
            if flag is not None and not acknowledged:
                try:
                    result = self.api.call("beginCharge", dict(data, msgflag=flag))
                    if result.get("success") is True:
                        acknowledged = True
                        self.state["acknowledged"] = True
                        self.save()
                    elif result.get("msg") != "设备无响应，请稍后再试！":
                        log("平台尚未确认开电；继续只核对本人的订单。")
                        flag = None  # Do not issue a new transaction after an explicit error.
                except ChargeError:
                    log("开电结果查询超时，继续使用原请求标识核对。")
            try:
                order = active_order(self.api, self.cfg)
                if matching(order, self.cfg) and acknowledged:
                    return self.finish("confirmed", f"平台已确认充电启动：设备 {self.cfg['device']}，插座 {self.cfg['port']}。请在微信查看实时充电状态。")
            except ChargeError:
                pass
        return self.finish("uncertain", "未能确认开电成功。已停止继续提交，避免重复扣费；请在微信核对订单。")

    def execute(self):
        s, cfg = self.state, self.cfg
        if not s.get("armed"):
            log("预约已执行或取消，不再提交。")
            return 0
        if (s.get("identity"), s.get("device"), s.get("port")) != (identity(cfg), cfg["device"], cfg["port"]):
            return self.finish("failed", "预约的账号或插座与当前配置不符，停止操作。")
        scheduled = datetime.fromisoformat(s["scheduled_at"])
        if not scheduled <= self.clock() <= scheduled + timedelta(minutes=10):
            return self.finish("expired", "当前不在预约的6:00–6:10执行窗口内，不启动充电。")
        if s.get("phase") in ("submitting", "pending"):
            self.progress("confirming", "正在核对原请求的开电结果。")
            log("恢复原请求的结果核对，不新建充电请求。")
            return self.verify(dict(s["payload"], openId=cfg["open_id"]), s.get("msgflag"))
        if s.get("phase") != "ready":
            return self.finish("failed", "预约状态异常，不启动充电。")
        # Reads may be retried. A new beginCharge submission is never retried.
        self.progress("waiting-opening", "正在等待平台恢复营业。")
        while self.clock() <= scheduled + timedelta(minutes=10):
            if not json.loads(self.path.read_text(encoding="utf-8")).get("armed"):
                return self.finish("cancelled", "预约已取消，不启动充电。")
            try:
                device = object_response(self.api.call("getDeviceInfo", {"areaId": cfg["area_id"], "devaddress": cfg["device"]}), "设备")
                if device.get("isWorkTime") in (1, "1"):
                    break
                log("平台尚未恢复营业，15秒后重新检查。")
            except ChargeError:
                log("设备查询暂时失败，15秒后重新检查。")
            self.sleep(15)
        else:
            return self.finish("failed", "6:10前平台仍未恢复营业，已放弃本次预约。")
        self.progress("booting", "平台已营业，等待设备恢复。")
        self.sleep(30)  # Give the physical station time to restart after opening.
        if self.clock() > scheduled + timedelta(minutes=10):
            return self.finish("expired", "等待设备恢复后已超过6:10，不启动充电。")
        self.progress("checking", "正在核对账户、余额和插座。")
        while True:
            try:
                device, user, order = snapshot(self.api, cfg)
                break
            except NetworkError:
                if self.clock() + timedelta(seconds=15) > scheduled + timedelta(minutes=10):
                    return self.finish("failed", "6:10前未能完成提交前核对，已放弃本次预约。")
                log("提交前查询暂时失败，15秒后重查；尚未发起扣费。")
                self.sleep(15)
            except ChargeError as exc:
                return self.finish("failed", str(exc))
        if matching(order, cfg):
            return self.finish("already-charging", "目标插座已有本人的充电订单，不重复提交。")
        if device.get("isWorkTime") not in (1, "1"):
            return self.finish("failed", "提交前平台不在营业状态，不启动充电。")
        if not json.loads(self.path.read_text(encoding="utf-8")).get("armed"):
            return self.finish("cancelled", "预约已取消，不启动充电。")
        if self.clock() > scheduled + timedelta(minutes=10):
            return self.finish("expired", "提交前核对已超过6:10，不启动充电。")
        data = payload(cfg, device, user)
        s.update(phase="submitting", submitted_at=self.clock().isoformat(),
                 payload={k: v for k, v in data.items() if k != "openId"})
        self.save()  # Persist before sending: a crash must never cause a second start.
        self.progress("submitting", "正在发送本次充电请求。")
        log(f"提交充满自停：设备 {cfg['device']}，插座 {cfg['port']}，账户余额付款，预扣不超过2元。")
        try:
            result = self.api.call("beginCharge", data)
        except ChargeError:
            log("提交响应丢失，仅查询订单，不重复提交。")
            return self.verify(data, None)
        if result.get("success") is not True:
            message = str(result.get("msg") or "无明确原因").replace(cfg["open_id"], "[账号]")
            return self.finish("rejected", "平台拒绝启动：" + message)
        flag = result.get("obj")
        if flag is None or isinstance(flag, (bool, dict, list)) or not str(flag):
            log("平台的请求标识格式异常，仅查询订单，不重复提交。")
            return self.verify(data, None)
        s.update(phase="pending", msgflag=flag)
        self.save()
        self.progress("confirming", "正在等待平台确认开电。")
        return self.verify(data, flag)


def main():
    parser = argparse.ArgumentParser(description="尼普顿：检查或预约一次早上6点充满自停")
    parser.add_argument("command", choices=("setup", "check", "reserve", "run", "cancel"))
    parser.add_argument("--url", help="付款页链接；省略时在终端粘贴")
    parser.add_argument("--reservation", type=Path)
    parser.add_argument("--confirmed-plug", action="store_true")
    args = parser.parse_args()
    try:
        if args.command == "setup":
            setup(args.url or input("粘贴微信付款页完整链接：\n").strip())
            return 0
        cfg = load_account()
        if args.command == "check":
            device, user, order = snapshot(Api(), cfg)
            log(f"检查通过：设备 {cfg['device']}，插座 {cfg['port']}，余额 {int(user['readyaccountmoney'])/100:.2f} 元，预扣 {int(device['yk'])/100:.2f} 元。")
            log("营业状态：" + ("营业中" if device.get("isWorkTime") in (1, "1") else "非营业时间，执行时会等待恢复"))
            log("本人已有目标订单，将跳过重复提交。" if order else "本人当前没有正在充电的余额订单。")
            return 0
        if args.command == "reserve":
            if not args.confirmed_plug:
                raise ChargeError("预约前需要确认车辆和充电器已接在目标插座。")
            snapshot(Api(), cfg)
            path = reserve(cfg)
            print(str(path))  # Machine-readable path for the Windows scheduler helper.
            return 0
        if args.command == "cancel":
            if LATEST.exists():
                path = Path(LATEST.read_text(encoding="utf-8").strip())
                if path.exists():
                    state = json.loads(path.read_text(encoding="utf-8"))
                    state.update(armed=False, phase="cancelled")
                    atomic_json(path, state)
            log("本机预约已取消。若充电已启动，请在微信结束订单。")
            return 0
        if not args.reservation or args.reservation.resolve().parent != (LOCAL / "reservations").resolve():
            raise ChargeError("预约路径不属于本工具。")
        with run_lock(args.reservation):
            return Runner(Api(allow_charge=True), cfg, args.reservation).execute()
    except (ChargeError, OSError, ValueError, KeyError) as exc:
        # Account contents and URLs are never included in normal exception messages.
        log(str(exc) if isinstance(exc, ChargeError) else f"本机配置或文件异常（{type(exc).__name__}），请重新检查预约。")
        return 1


if __name__ == "__main__":
    sys.exit(main())

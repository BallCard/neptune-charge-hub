# Windows 执行模块

从原 `neptune-charge-scheduler` 整合，标准库 Python + Windows 单次任务，失败通知沿用本机邮箱配置。主界面使用根目录 `open-hub.cmd`。

已有电脑继续使用原目录的兼容入口与数据，不搬迁 DPAPI 账号、不改变任务引用路径。源码在这里维护；原 Python 入口保留 `__file__`，原 PowerShell 入口传递其运行根。独立克隆后可通过此目录 `setup-account.cmd` 导入本人付款页，不能复用其他 Windows 用户的加密文件。原兼容目录 `neptune-charge-scheduler` 已于 2026-11-05 归档至 `D:\Workspace\archive\neptune-charge-scheduler`，其入口同时兼容归档位置；本机 Windows 任务定义未改写。

离线验证：`python -B -m unittest discover -s tests -v`。日常只读核对使用 `check.cmd`。真实预约必须本人接好车辆后确认；每次新开电请求只发一次，不明结果不重发。`open-ui.cmd` 是历史界面的兼容入口，统一产品入口在项目根。

运行记录、邮箱配置、预约与凭据仅在 `.local/`、`logs/`，不进入 Git 或网页部署包。完整项目整合与云端边界见根目录 README。

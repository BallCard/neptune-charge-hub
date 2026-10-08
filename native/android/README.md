# Android 本机执行器

测试版0.3.0-test，包名 `cn.neptune.local`，Android8/API26起、目标API35。前端和ZXing-WASM内置于APK，Vercel只分发程序。已完成编译、签名和离线核心验证；安装、WebView、权限、锁屏、真实开电与系统通知仍需实机验收。

项目根先 `npm ci`、`npm run build`，依次运行 `scripts/prepare-android-toolchain.ps1`、`scripts/test-android-core.ps1`、`scripts/build-android.ps1`，最后再 `npm run build` 供网页分发最新APK。完整命令见[项目入口](../../README.md)。

工具来自Adoptium、Google Android官方仓库、Maven Central，核对下载校验值，存入 `.local/android-toolchain/`，不安装全局JDK或Gradle。打包采用javac/d8/aapt2/zipalign/apksigner。Android提供运行时JSON，Maven JSON jar仅主机测试。

APK位于 `public/downloads/neptune-local-assistant.apk`，Git忽略二进制；版本元数据含SHA256和 `realDeviceValidated=false`。开发签名私钥不上传，默认开发密码不作正式发布密钥。异机新签名不能覆盖同包旧安装，长期发布需正式签名与版本升级流程。

## 职责

- `MainActivity`：内置网页、受限桥接、图片选择、权限及配置备份。
- `LocalVault` / `BackupCodec`：AES-GCM、Keystore和单独密码配置备份。
- `WorkflowController` / `AlarmScheduler`：只读绑定、实际方案、冻结预约、单次准确闹钟和15分钟备用检查。
- `ChargeRunner` / `Platform`：等营业、重新核对、持久化占用、一次新请求和原token确认；`reviewed` 不追认旧请求成功。
- `NotificationResult`：只发送终态手机结果，独立状态、最多3次；权限或通知失败不改变开电结果，重试不发起订单。
- `ResultMail`：仅兼容旧冻结SMTP预约；新预约使用本机通知，不要求邮件配置。
- `ChargeService` / Receivers：短时前台服务、唤醒锁、重启及授权后的恢复。

适用于已核验的40型、电量计费、余额付款。方案取 `yuan5`、`yuan11`、`ycTime` 等实时字段。公开页面脚本显示 `money=7`，充满自停 `yuan7=0`，定时为分钟，保留 `fullStop=0` 智能保护。观察来源：[官方付款页](https://www.szlzxn.cn/wx/indexn.html)及其公开脚本，不把它当作稳定API承诺。

## 实机验收

先只读核对账号、二维码、方案、金额和时间；取消未来预约并确认未产生订单。车辆接好、本人确认后，设置3–5分钟后的单次预约，退出并锁屏，查系统通知、微信目标订单及功率，核对助手内结果与通知状态。最后验隔夜06:00、断网和重启；厂商限制需各手机验证。

真实预约只由使用者确认发起。提交不明先查微信，不能为测试重发同次启动。通知报告启动检查，不承诺充满。iPhone见[独立验证](../../docs/iphone-shortcuts-validation.md)，不能安装本APK。

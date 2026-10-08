# 晨充 · Neptune Hub

上传充电口二维码 → 导入本人付款页授权 → 选择平台实际方案 → 默认**明天北京时间06:00** → 本机执行单次开电 → 手机系统通知结果。无需填写邮箱；二维码只提供插座，不能代替账号授权。授权链接也含插座，可直接导入。

**安卓测试版0.3.1-test已实现本地执行器和系统通知**，离线检查通过。安装、锁屏定时、手机系统权限、真实开电与通知尚未在手机验收。iPhone 可打开网页识别二维码，自动执行快捷指令尚未接入；“添加到主屏幕”不提供后台执行能力。

## 使用

- [分享给同学的网页](https://neptune-charge-hub.vercel.app/)
- [安卓本机助手 APK](https://neptune-charge-hub.vercel.app/downloads/neptune-local-assistant.apk)
- [安装包版本与校验值](https://neptune-charge-hub.vercel.app/downloads/version.json)

安卓8及以上，保持 Android System WebView 更新。每人安装助手并在**晨充本机助手**中配置，无需开发者邮箱注册、云数据库或常开电脑。普通浏览器只识别二维码，账号字段和预约按钮禁用。

1. 开启精确定时与通知，按手机电池设置允许后台联网；系统拒绝登记时不会显示预约生效。
2. 在微信尼普顿付款页复制本人完整链接，导入一次。向官方进行只读核对后，账号加密保存到手机。
3. 默认手机系统通知，不填写邮箱或邮箱授权码。网站主流程为手机单页，首次显示使用场景介绍，授权旁可展开教程；安装说明单独提供。
4. 上传插座二维码，核对设备和端口，点击核对插座。方案以真实设备为准；480分钟仅在平台返回480时出现。定时方案60、120、240、360分钟按支持情况显示。
5. 接好车辆和充电器，选方案、时间、预扣上限并勾选确认。默认始终是**下一个上海日历日06:00**；可改为1分钟后至48小时内。预扣上限0.01–10.00元，默认2元，最终电费以平台为准。
6. 本机记录和系统单次闹钟均成功后显示“预约已生效”。到点重新核对账号、余额、插座、方案和费率；最多等待营业10分钟，营业后等设备30秒再核对。不开循环任务。
7. 记录区分确认启动、已有本人订单、未启动和结果不明；完成后提交手机系统通知。通知失败不会改写充电结果，单独重试也不重新开电。“已提交系统提醒”不保证使用者已看到。

手机需开机、联网且未被强制停止。厂商后台限制需实机核验。每次预约须本人确认接好；活动预约期间不能另建或更换配置。取消限尚未执行且距开始超过30秒。

新开电请求只提交一次，丢失响应不重新扣款。不明结果限制后续预约；在微信核对订单与扣款后确认已查明，官方当前无本人订单才能解除限制，旧请求不会重发。通知明确失败可单独重试，累计最多3次。旧版本已登记预约的邮件配置仍按原冻结配置处理，新预约不使用SMTP。

仅支持已核验的40型、按电量计费、余额付款设备，其他设备或付款方式停止。满200条记录后测试版停止新建，当前配置备份不用于腾空或转移预约。

## 本机数据

账号、冻结预约和记录加密存入 Android 私有目录，密钥在 Keystore。APK内置网页和ZXing-WASM解码器，执行不加载 Vercel 远程代码。必要账号参数直接发尼普顿；通知留在手机，开发者云端不保存凭据或计划。旧版本邮件配置如存在仍在本机。

导出配置备份需单独设置8字符以上密码；仅含账号配置（兼容已有旧邮件配置），**不含预约，不恢复定时任务**。恢复限空配置空间，选文件和解密均在本机。请选择本机目录；卸载或丢失备份密码无法由网站恢复。

旧浏览器 IndexedDB 未清理，新版不读取它，旧备份不直接导入助手。旧计划从未自动执行，不迁移成生效预约。见[本机数据说明](docs/local-data.md)与[苹果只读验证](docs/iphone-shortcuts-validation.md)。

## 开发与验证

Node.js22及以上；Windows脚本将 JDK17、Android35工具放入本项目忽略目录，不修改全局环境。

```powershell
npm ci
npm run typecheck
npm test
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/prepare-android-toolchain.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-android-core.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-android.ps1
npm run build
npm start
```

第一次网页构建供 APK 内置，APK 构建后第二次把最新安装包复制到 `out/`。构建器拒绝旧网页与源码不匹配。见[安卓开发和实机验收](native/android/README.md)。24项 TypeScript、26项 Java 离线检查通过，未读取个人凭据、建真实订单或发真实邮件。真实倾斜照片回归素材仅在本机忽略目录，其他环境自动跳过该项；合成二维码检查随仓库运行。

预览 `http://127.0.0.1:3086/`；`npm run dev` 用于前端开发。无需 `.env.local`，网页无业务API。`src/lib/neptune.ts` 保留协议参考及测试；安卓执行采用 Java。

## 发布与来源

Vercel独立项目 `neptune-charge-hub`、团队 `ballcards-projects`。只上传筛选后的静态网页、图标和 APK，不上传 `.local/`、签名私钥、账号或备份。先 `node scripts/prepare-static-deployment.mjs`，再用输出目录：

```powershell
node scripts/vercel-cli.mjs deploy --cwd <生成的目录> --prebuilt --prod --yes
```

[原个人Windows工具](../neptune-charge-scheduler/README.md)、账号、日志和任务未改。旧网页和云原型留在本机恢复记录；早先空白云资源未删除，也不接收新版数据。

本轮通过 Antigravity 重新请求 Gemini 生成前端。目录没有3.5 Pro；请求 `gemini-3.1-pro-high`、代理返回 `gemini-pro-agent`，不保证隐藏的底层版本。见[调用与修订来源](docs/gemini-frontend.md)、[变更记录](CHANGELOG.md)。

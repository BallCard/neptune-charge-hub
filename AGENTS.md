# 晨充协作约定

- 本项目是静态网页＋Android本机助手；iPhone自动执行未接入。个人Windows基线在 `../neptune-charge-scheduler`，账号与任务独立；运行见 [README](README.md)。
- 日常验证用离线数据、测试账号或只读接口，不创建真实订单；真实预约每次须本人确认车辆已接好，不循环启动公共插座。
- 凭据、冻结预约与记录在Android私有目录加密，密钥用Keystore；只加载内置网页，不向远程网页开放桥接。日志、提示词、Git、APK与部署包不得含个人链接、凭据或签名私钥。
- 产品按二维码／本人付款页授权→真实方案→下一上海日历日06:00→单次开电→系统通知；二维码不替代账号授权，新预约不要求邮箱。锁屏、权限、订单与通知尚需真机验收。
- 开电前持久化占用并核对方案、费率、余额和插座，变化则停止；请求只发一次，丢失响应不重发。仅本机记录与单次定时均确认才显示预约生效，原请求与本人订单匹配才显示启动确认。
- 开电与通知结果独立，通知重试不重新开电，提交提醒不等于已读；不明结果限制后续预约，仅本人微信核对且平台无当前本人订单后解除，旧请求不重发。
- 配置备份不含预约，恢复不登记任务；旧预约保留冻结邮件兼容，SMTP接受不保证入箱，发送不明不重发；密码由用户保管。
- 修改网页后依次构建、打包APK、导出最新静态包；按 [Android验收](native/android/README.md) 与 README 验证，只发布筛选目录。未经执行器确认不显示订单成功，构建通过不称手机实测。

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

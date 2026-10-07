# 项目协作

- 本项目是晨充通用版本：Vercel静态网页与Android本机助手；iPhone快捷指令未接入。个人Windows基线在 `../neptune-charge-scheduler`，不要修改该项目、账号或原任务。
- 日常验证使用离线数据、测试账号和只读接口。真实预约需要使用者确认车辆已接好；测试不得创建真实充电订单。
- Android账号、SMTP、冻结预约与记录仅在应用私有目录加密存储，密钥在本机Keystore；配置备份密码由用户保管。日志、提示词、Git、APK和部署包不得含个人链接、凭据或签名私钥。安卓仅加载内置网页，不向远程网页暴露本机桥接。
- 产品目标是上传插座二维码、选择真实充电方案、确认接好后默认明天北京时间6:00自动开电，再发送成功、失败或结果不明的邮件。二维码不代替首次本人账号授权，通知邮箱由使用者指定。默认明天固定为下一个日历日。
- 当前安卓测试版已实现执行器并通过离线检查，锁屏、权限、真实订单与SMTP尚未实机验收。不能将网页主屏幕入口宣称为后台能力，也不能把构建通过当作手机实测。
- 不得显示预约已执行、平台订单成功等未经执行器确认的状态。必要的平台请求和用户指定邮箱的结果通知不属于把私人数据上传开发者云端。
- 提交充电前必须持久化占用状态；新建充电请求只允许一次。平台响应丢失时不重新提交。
- 仅本机持久化与系统单次定时均确认才显示预约生效，原请求确认与本人插座订单匹配后才显示启动确认。执行前核对方案、费率、余额与插座，变化则停止。
- 开电与邮件状态独立；邮件失败不得改变启动结果。SMTP接受不等于保证入箱；邮件发送不明不重发。配置备份不含预约、恢复不登记任务。
- 不明结果限制后续预约，仅用户在微信核对且平台无当前本人订单后解除，旧请求仍不重发。网页修改后重新构建、打包APK、再导出最新静态包，发布只用筛选后的目录。
- 自定义安排是待确认的计划。每次启动仍需本人确认车辆已接好，不能无条件循环为公共插座开电。

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

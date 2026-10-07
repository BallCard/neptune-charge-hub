# 项目协作

- 本项目是尼普顿本机数据的手机网页工具，支持安卓和 iPhone 主屏幕入口；个人 Windows 基线在 `../neptune-charge-scheduler`，不要修改该项目或原有任务。
- 日常验证使用离线数据、测试账号和只读接口。真实预约需要使用者确认车辆已接好；测试不得创建真实充电订单。
- 个人账号、设置、计划和记录只在浏览器 IndexedDB 加密存储；密码只用于本机解锁。不得把个人数据发送给开发者云端。日志、模型提示词、Git 和部署包不得包含私人付款链接或凭据。
- 当前版本只保存计划，不定时开电。不得显示预约已执行、平台订单成功等未经执行器确认的状态。安卓后台执行与苹果快捷指令另行接入、实机验证。
- 提交充电前必须持久化占用状态；新建充电请求只允许一次。平台响应丢失时不重新提交。
- 自定义安排是待确认的计划。每次启动仍需本人确认车辆已接好，不能无条件循环为公共插座开电。

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

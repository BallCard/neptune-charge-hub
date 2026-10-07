# 项目协作

- 本项目是尼普顿本机数据的手机网页工具，支持安卓和 iPhone 主屏幕入口；个人 Windows 基线在 `../neptune-charge-scheduler`，不要修改该项目或原有任务。
- 日常验证使用离线数据、测试账号和只读接口。真实预约需要使用者确认车辆已接好；测试不得创建真实充电订单。
- 个人账号、设置、计划和记录只在浏览器 IndexedDB 加密存储；密码只用于本机解锁。不得把个人数据发送给开发者云端。日志、模型提示词、Git 和部署包不得包含私人付款链接或凭据。
- 产品目标是上传插座二维码、选择真实充电方案、确认接好后默认明天北京时间6:00自动开电，再发送成功、失败或结果不明的邮件。二维码不代替首次本人账号授权，通知邮箱由使用者指定。默认明天固定为下一个日历日。
- 当前线上版本只保存计划，尚未完成核心流程；这是实现状态，不能把它当作用户放弃自动执行的要求。数据留本机的要求仍生效；自动执行需接入本地执行器并实机验证，不能宣称静态网页已具备后台定时能力。
- 不得显示预约已执行、平台订单成功等未经执行器确认的状态。必要的平台请求和用户指定邮箱的结果通知不属于把私人数据上传开发者云端。
- 提交充电前必须持久化占用状态；新建充电请求只允许一次。平台响应丢失时不重新提交。
- 自定义安排是待确认的计划。每次启动仍需本人确认车辆已接好，不能无条件循环为公共插座开电。

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

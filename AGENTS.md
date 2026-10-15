# 晨充协作约定

- 本项目统一维护手机单页、Supabase 云端、`native/windows/`电脑兼容源码和`modules/nearby/`玉泉空位。以网页为唯一新开发入口，不再构建或发布APK；Android源码仅保留历史。运行状态见 README。
- 修改前检查Git状态。Windows账号、已存在任务、运行记录及引用路径不搬迁，不把已有电脑预约复制为云端计划。
- 若无其他说明，修改与测试均围绕当前线上正式版本：先核对正式部署与所用云端项目，以线上结果验收；本地和隔离检查作为补充，不能代替线上验证。
- 日常验证使用离线数据、隔离接口或只读查询。真实预约由本人确认车辆已接到指定插座，新开电请求只提交一次，结果不明只核对原请求和本人订单。
- 付款链接、账号标识、邮件凭据、服务端密钥、冻结配置、日志及测试照片不得进入Git、提示词或公开部署。云端付款身份须本人手动导入、服务端加密保存；公开客户端仅使用publishable key。
- 云端API逐次验证用户身份，并在服务端限定user_id。公开表启用RLS并撤销不需要的权限；不信任客户端用户编号或user_metadata。数据库占用须先于新开电，重投、超时及崩溃恢复不得重复新建请求。
- 预约只有持久记录和定时执行器均确认后才显示生效。先核对真实方案、费率、余额与插座，改变就停止；结果不明继续限制后续预约，本人微信核对且平台无本人当前订单后才解除。
- 单页保留永久新手指引、授权教程、公开附近查询、北京时间预约与结果记录。网页关闭不取消云端计划；未接入的能力保持禁用，未做手机/现场验收的结果如实标注。
- 附近查询只用公开getDeviceInfo。站点原始坐标BD-09，地图显式换算，定位默认只用于浏览器本页计算。Windows桥接限127.0.0.1，保留会话、Host与Origin保护。
- 有意义的功能、配置与验证记入CHANGELOG。网页修改后做适量类型、离线、构建及浏览器检查，再生成筛选部署目录；不上传账号、日志、备份或电脑运行目录。
<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# 晨充协作约定
- 当前主线为免注册校园网页云端预约：2026-10-21按用户最新要求取消邮箱注册、密码与验证码流程，首次使用预约时自动建立独立浏览器身份并持久保存会话；只查看端口不创建身份。每人独立付款授权和预约，清除网站数据或换设备不能自动找回，原预约仍执行；保留旧邮箱身份及折叠恢复入口，不迁移、合并或清空原记录。魔搭承载网页与Node.js执行端，复用Supabase与唯一分钟调度，电脑无需开机。此前Gmail配置仅作历史保留，不继续推进注册发信。原个人版、Vercel、Windows执行器及玉泉空位源码保留；其他平台迁移暂停，以网页为唯一新开发入口，不再发布APK。运行状态见 README。
- 修改前检查Git状态。Windows账号、已存在任务、运行记录及引用路径不搬迁，不把已有电脑预约复制为云端计划。
- 若无其他说明，修改与测试围绕当前魔搭正式版：先做离线、隔离与浏览器验证，发布前核对目标部署及云端项目，并以线上结果验收；真实开电仍须本人现场确认，不将本机结果作为线上通过证据。可另建Vercel等网页入口，但公开网页不能视为本机执行器；不得公开本机控制接口。调整主线不等于停用已有服务或调度，处理前先核对现有预约。
- 日常验证使用离线数据、隔离接口或只读查询。真实预约由本人确认车辆已接到指定插座，新开电请求只提交一次，结果不明只核对原请求和本人订单。
- 付款链接、账号标识、邮件凭据、服务端密钥、冻结配置、日志及测试照片不得进入Git、提示词或公开部署。云端付款身份须本人手动导入、服务端加密保存；公开客户端仅使用publishable key。
- 云端API逐次验证用户身份，并在服务端限定user_id。公开表启用RLS并撤销不需要的权限；不信任客户端用户编号或user_metadata。数据库占用须先于新开电，重投、超时及崩溃恢复不得重复新建请求。
- 预约只有持久记录和定时执行器均确认后才显示生效。先核对真实方案、费率、余额与插座，改变就停止；结果不明继续限制后续预约，本人微信核对且平台无本人当前订单后才解除。
- 单页保留永久新手指引、授权教程、北京时间预约与结果记录；按本人最新要求默认端口查看页，登录恢复不自动跳走，教程由常驻入口打开；空位仅在查看该栏时按需刷新，魔搭直接读取公开设备状态，访客共享30秒缓存；执行前必要的目标插座/方案/余额/本人订单检查必须保留。个人预约由云端执行，网页关闭或电脑关机不取消计划。本地预约须说明到点电脑需开机、联网且未休眠；已登记任务不依赖网页保持打开，既有云端计划仍按原机制执行。未接入的能力保持禁用，未做手机/现场验收的结果如实标注。
- 附近查询只用公开getDeviceInfo。站点原始坐标BD-09，地图显式换算，定位默认只用于浏览器本页计算。Windows桥接限127.0.0.1，保留会话、Host与Origin保护。
- 有意义的功能、配置与验证记入CHANGELOG。网页修改后做适量类型、离线、构建及浏览器检查，再生成筛选部署目录；不上传账号、日志、备份或电脑运行目录。
<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

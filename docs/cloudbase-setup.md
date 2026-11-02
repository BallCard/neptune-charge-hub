# CloudBase 开发工具接入

核对日期：2026-10-15。按[官方接入说明](https://docs.cloudbase.net/skill.md)安装，仅接入开发工具，尚未部署晨充或购买云资源。

## 已完成

- 官方 `TencentCloudBase/cloudbase-plugin` 已安装到当前 Windows 用户的 Codex，插件已启用，包含33个技能和 CloudBase MCP 配置；未在其他编辑器重复安装。
- 官方命令行 `@cloudbase/cli` 已安装，实测版本3.8.6。当前会话尚无 CloudBase MCP 工具，使用命令行继续；重载 Codex 后再核验 MCP 登录状态。
- 本项目使用腾讯云国内站，站点记录在 `.cloudbase/project.json`。`ap-shanghai` 为接入时的默认查询地域，不表示已选定部署环境。命令行核对 `isIntl=false`，未改动机器全局站点或默认环境。
- 已发起官方设备码登录，等待本人在腾讯云页面完成登录与 CLI 授权；尚不能确认账号可访问的环境，未填写或猜测环境编号。
- 现有 Vercel 正式站调度健康检查通过。本次没有变更正式入口、Supabase 数据库、登录回跳或唯一分钟调度。

## 授权后核验

在项目目录执行；设备码过期时重新运行登录即可，不将登录链接或凭据写入项目文件。

```powershell
$env:TCB_IS_INTL = 'false'
tcb login
tcb env list --json
```

从实际列表确认目标环境后，按完整环境编号和实际地域显式查询；不依赖机器全局默认环境。若列表为空，先核对国内站账号和查询地域，再决定是否创建环境。创建或部署前须核对实际套餐、费用和目标环境。

本机凭据由官方工具保存在用户配置目录，不进入 Git、部署包或文档；`.cloudbase/` 仅允许提交不含凭据的站点记录。

## 最相关的下一步

用 CloudBase 云托管部署独立的最小只读探测程序，仅验证尼普顿公开 HTTPS `getDeviceInfo` 和现有 Supabase 公开接口的连通性，检查多轮读取、空闲后重访及费用口径。先不传入服务端密钥、付款身份或预约记录；通过后再接续[迁移核对](coze-deployment-assessment.md#国内托管备选与下一步)。

工具接入、只读探测和完整迁移分别验收；工具接入不能作为线上业务或真实开电已通过的证明。

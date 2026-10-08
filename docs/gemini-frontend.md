# Gemini 前端生成来源

## 手机单页与通知简化 · 2026-10-08

按用户要求再次调用Antigravity/Gemini，生成紧凑单页，去掉下载能力卡和SMTP表单，加入折叠授权教程。新通知方式为手机系统通知。提示仅含接口契约与通用设计要求，未传送用户照片、插座号码、付款链接或账号。

模型目录无3.5 Pro。请求`gemini-3.1-pro-high`，响应`gemini-pro-agent`，HTTP200/stop；返回TSX16097、CSS5749字符，完成时间`2026-10-07T16:10:52.185Z`（北京时间10月8日00:10）。提示SHA256 `a5fcb87f260b7073aac4d7a700610cd09c008ea00be6539c7756b90fcad9033a`。本机忽略目录保存`gemini-compact-*`证据。

主控修正UTC与北京时间默认值、状态刷新导致确认框重置、金额校验与精度、重试通知终态范围、无障碍标签和忙碌禁用，压缩首屏布局。首次使用介绍浮层、ZXing-WASM本机图片修复、官方wxscan入口解析和Android通知逻辑由主控实现。模型返回名不保证其隐藏底层版本。

## 本轮重做 · 2026-10-07

用户明确“二维码→真实方案→明天06:00自动开电→邮件”后，重新通过本机Antigravity生成 `charge-workflow.tsx` 和 `charge-workflow.css`。这次并非继续使用下文旧计划界面。鉴权只从本机应用配置在调用进程内读取，不进入源码、提示词或发布包。

- 实时模型目录仍没有3.5 Pro；请求 `gemini-3.1-pro-high`，响应 `model=gemini-pro-agent`、HTTP200、`finish_reason=stop`。
- 返回TSX20968字符、CSS9739字符；usage：prompt2034、completion10475、total18439、reasoning5930。
- 完成时间 `2026-10-07T13:24:37.989Z`（北京时间21:24:37）；此处UTC来自结果记录，不和下文旧日志时间混用。
- 提示词SHA256：`451e64af4ab5f45711f3d9d0a7e15d2b6941ddb6d4b73fe4c038f05a13c800fd`。完整脱敏提示、响应和证据保存在忽略的 `.local/artifacts/gemini-rebuild-*`，不含用户付款信息。

提示词明确上传图片、通过真实执行端核对并登记、48小时内的单次预约、独立接好确认、实际邮件状态、无执行端时不可预约、禁止虚构数据及直接网络调用。方案必须来自执行端，不写死480分钟。首次配置仅本机解析付款链接和SMTP，二维码不能代替本人账号。

集成由主控完成：修正生成文件末尾多余引号与CSS选择器错误；完善表单标签、只读字段、失败时不清空确认、浏览器禁用凭据；补充账号更换、真实营业状态与核对时间、结果不明人工核对、仅重试邮件、键盘可用的设置折叠。二维码、原生桥接、加密、Android定时与平台/邮件执行均为主控实现，不归功于Gemini前端调用。

22项TypeScript和23项Java离线检查、正式构建与APK签名验证通过。手机锁屏、实际订单与SMTP仍待实机验收。下文保留历史调用事实，其中已删除组件与“只保存计划”规则不再是当前实现。

生成日期：2026-10-07，北京时间。此记录只包含开发提示词、脱敏模型调用证据与交接说明，不包含账号、付款链接、API 密钥或令牌。

## 实际调用

- 本机 Antigravity Tools `/health` 实时返回 `status=ok`、`version=4.9.6`。
- 实时 `/v1/models` 包含 `gemini-3.1-pro`、`gemini-3.1-pro-high`、`gemini-3.1-pro-low`；没有 Gemini 3.5 Pro。3.5 名称下仅有 Flash 系列，因此没有将 3.1 Pro 称为 3.5 Pro。
- 调用端点：`POST http://127.0.0.1:8045/v1/chat/completions`，OpenAI 兼容格式，`stream=false`。鉴权只在调用进程内从本机应用配置读取，未写入项目。
- 两个请求均指定 `model=gemini-3.1-pro-high`，响应的 `model` 均为 `gemini-pro-agent`。此名称是代理返回的后端标识，不能据此宣称隐藏的具体底层版本。

| 请求 | 北京时间日志时间 | HTTP | requested model | response.model | 日志 mapped_model | finish_reason | 耗时 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 最小能力核验 | 2026-10-07 13:17:10.908 +08:00 | 200 | gemini-3.1-pro-high | gemini-pro-agent | gemini-pro-agent | stop | 5,331 ms |
| 完整两文件生成 | 2026-10-07 13:20:01.833 +08:00 | 200 | gemini-3.1-pro-high | gemini-pro-agent | gemini-pro-agent | stop | 121,943 ms |

最小核验提示词为 `Reply with only GEMINI_PROXY_OK.`，实际响应为 `GEMINI_PROXY_OK`，`max_tokens=1024`。完整生成使用 `max_tokens=24576`，响应完整解析为 JSON，未出现 `finish_reason=length`。

证据另从本机 `proxy_logs.db` 以 SQLite `mode=ro` 独立读取：两条记录的 `model` 均为 `gemini-3.1-pro-high`，`mapped_model` 均为 `gemini-pro-agent`，`status` 均为 200；时间戳分别为 `1791350230908` 与 `1791350401833`。日志只提取模型、状态、时间、耗时，未读取或复制请求正文中的私人数据。

完整生成响应 usage：`prompt_tokens=1164`、`completion_tokens=10097`、`total_tokens=18835`、`reasoning_tokens=7574`。保存结果为 `src/components/charge-dashboard.tsx`（19,502 字符）和 `src/components/charge-dashboard.css`（8,900 字符），均为 Gemini 返回的完整文件；后续集成修订由主控代理接手。

## 完整生成提示词

```text
你是资深 React / TypeScript 前端工程师。生成真实可运行、类型正确、移动优先的中文校园电动车充电预约工具「晨充 / Neptune Hub」前端。只返回一个严格 JSON 对象 {"tsx":"完整组件源码字符串","css":"完整CSS字符串"}，不要Markdown，不要解释，不要遗漏代码。
你必须实现两个文件 src/components/charge-dashboard.tsx 与 charge-dashboard.css。TSX 首行 "use client"；import "./charge-dashboard.css"；使用 React hooks 和 lucide-react 图标；独立普通 CSS，不使用 Tailwind；不依赖外部图片或网络。默认导出 ChargeDashboard。可自行定义并导出接口类型，无需导入项目业务类型。组件 props 完全严格如下：
state={userEmail:string,configured:boolean,chargingEnabled:boolean,targets:Array<{id:string,label:string,device:string,port:string}>,preferences:{defaultTime:string,weekdays:number[],maxPrepayCents:number},reservations:Array<{id:string,target_id:string,scheduled_at:string,phase:string,result?:unknown,created_at:string}>,live:null|{balanceCents:number,powerWatts:number|null,businessOpen:boolean,activeOrder:boolean,updatedAt:string},error?:string}。
busy:boolean；onAction(action:string,payload:Record<string,unknown>):Promise<void>；onLogout():void。
请把 result 作为 unknown 类型安全处理，只展示可用的简短状态说明，不把对象直接作为 React 子元素。所有账户、充电及预约真实交互仅通过 onAction 或 onLogout。禁止 fetch、模拟数据、伪造成功状态、保存私人链接/凭据、localStorage/sessionStorage、自动启动充电。onAction 成功后外层主控会更新 state。
布局与视觉：暖白色画布、深绿色主色、克制橙色点缀；高品质、有清晰层级与留白。桌面左侧导航、手机底部导航，overview/settings/history 三tab；以「下一次充电」大卡为核心。显示当前真实余额、瞬时功率、服务状态、时间戳；无 live 用「待刷新」，activeOrder 不等于假设功率非零。执行步骤时间线用 phase 的实际状态，历史列表真实数据和明确空状态。日期显示本地时区并标注当前设备时间，格式化不应抛异常。选择器和日期时间表单带 label、校验、按钮禁用逻辑及错误反馈；aria 可访问，键盘焦点明显，busy 时禁用提交，卡片 min-width:0，页面禁止横向溢出。手机字体不小于14px，主要控件至少44px。
未配置显示首次绑定引导：付款页链接放隐藏的 password input（带显示/隐藏按钮）；别名 label。仅提交 importAccount {url,label}；成功后必须清空链接字段；校验非空 HTTPS URL，提示链接等同账号凭据，不能分享给他人。不展示链接。
目标插座设置：表单 label/device/port；device、port 都是 string；提交 saveTarget {label,device,port}，删除 deleteTarget {id}，保留确认步骤和无目标引导。
偏好设置：defaultTime HH:mm、weekdays 整数0-6代表周日至周六、maxPrepayCents 整数1-200（最多2元）；提交 savePreferences {...preferences}；可以输入金额元，转换整数分并校验。说明「星期偏好仅帮助选择，不会自动循环给公共插座开电」。
预约：从已有 targets 选设备，date + time 可选，默认时间从 preference；仅允许未来且最多7天内的计划、不得与本用户 queued/scheduled/running/submitting 启动中的计划冲突；示意一周范围但不假造可用时段。预约前必须独立 checkbox 明确「我的车已接好，插座与设备无误」，展示选定日期时间、设备编号/端口、最多预扣金额的清晰确认。提交 reserve {targetId,scheduledAt: ISO string,confirmedPlug:true,idempotencyKey:crypto.randomUUID()}。预扣不是最终电费。configured 与 chargingEnabled 为 false 时不能预约，要显示服务状态原因。提交成功后清空确认 checkbox。不要添加“立即充电”或“开启循环”按钮。
取消：调用 cancel {id}，仅 phase 为 queued/scheduled 且 scheduled_at 距当前至少30秒时可取消；以实际当前时间定时更新（例如每15秒）的取消可用性，避免长期打开页面导致可用性过时。请不要添加前端测试或额外文件。
刷新：refresh {}，显示 loading；失败要捕获，提供可理解的错误文案，避免未处理 promise；按钮不能虚构完成。
安全说明必须可见且短：每次预约都需确认车辆已接好；最长480分钟不等于9点自动停止；最终金额和是否充电以平台真实状态为准；跨周计划仅偏好，不自动为公共插座循环开电。
请生成合理紧凑的完整实现，不要过度包装，不要输出任何真实账号信息或密钥。CSS仅作用于 .charge-app 或 nh- 前缀，避免污染页面全局。
```

## 交接与修订边界

上面的提示词保留原始生成事实，不能当作最终业务规则。主控代理在与实际服务接口核对后接手以下修订：

- 预约窗口收回为未来 **24 小时内**；原提示词的 7 日范围作废。
- 应用固定使用 `Asia/Shanghai`；默认预约时间若今天已过，应选择下一个有效时间。
- 活动阶段集合以 `queued/scheduled/waiting/checking/submitting/pending` 为准，原提示词的 `running` 不作为业务依据。
- 绑定别名符合后端至少 1 字符校验；兼容官方原始 HTTP 付款链接，而不是要求其原始链接一定为 HTTPS。
- 首次绑定界面同样显示退出登录与实际错误状态。

本生成代理在交接后不再改两组件，避免并行覆盖。组件构建验证由主控代理负责；生成来源记录不等同于整项产品验收或真实充电验证。

## 本机版本的后续修订

用户随后要求个人数据留在本机，并选择安卓先做可添加到主屏幕的手机网页，定时执行另行接入。主控在 Gemini 生成界面的基础上完成了本机加密空间、备份、移动布局与主屏幕入口的集成；这些后续修订没有再次调用 Gemini。

当前界面去掉云端登录，账号链接只在本机解析并加密存储；活动计划状态为 `planned`，取消为 `cancelled`，过期为 `expired`。页面明确显示“计划已保存 · 未启用自动执行”，隐藏真实执行进度与余额占位，不能根据上方历史提示词推断已经启用自动充电。

此版本以静态网页发布到 Vercel。22项离线测试、类型检查、正式构建和浏览器数据持久化验证通过；安卓与 iPhone 的实际安装、离线及快捷指令执行仍待实机验证。

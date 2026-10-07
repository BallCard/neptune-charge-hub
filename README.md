# 晨充 · Neptune Hub

安卓和 iPhone 可用的本机充电计划网页。账号、设备、偏好、计划与记录只在使用者当前浏览器加密保存，Vercel 只托管静态页面。

用户已选择安卓先做手机网页、可添加到主屏幕，定时执行另行接入。**当前版本只保存计划，不会自动开电，也未完成手机实机验证。**

## 使用

正式网址：[neptune-charge-hub.vercel.app](https://neptune-charge-hub.vercel.app/)。可直接把这个地址分享给同学，各自创建本机空间。

1. 手机打开网站，先添加到主屏幕；安卓可使用页面安装按钮或浏览器菜单，iPhone 使用 Safari 分享菜单。
2. 创建本机空间并设置至少8个字符的密码。无需邮箱注册，密码不发送给网站。
3. 从微信尼普顿付款页复制一次完整链接，保存到本机。网页只在本机解析账号与设备，不请求平台验证或创建订单。
4. 设置多个常用插座、北京时间、星期建议和0.01–2.00元的金额上限。接好车辆后保存一个未来24小时内的本机计划。
5. 在偏好设置导出加密备份。恢复需原密码和空浏览器空间；换设备、换浏览器不会自动同步。

计划显示“已保存 · 未启用自动执行”，可取消、导出和查看过期状态。导出的计划不含账号授权，不能直接执行。余额和实际订单仍在微信查看。

详细的保存、备份和执行边界见[本机数据说明](./docs/local-data.md)。苹果快捷指令尚未制作或实机验证，先按[只读测试](./docs/iphone-shortcuts-validation.md)核对。

## 开发与验证

Node.js 22及以上，源码依赖版本固定：

```powershell
npm ci
npm run typecheck
npm test
npm run build
npm start
```

打开 `http://127.0.0.1:3086/`。`npm run dev` 用于开发；正式构建静态文件在 `out/`，构建后生成离线缓存程序。不需要 `.env.local` 或任何云密钥。

验证使用虚构账号与离线响应，不读取个人工具的配置，不创建真实充电订单。协议适配器保留为后续执行器参考，当前前端没有调用它。

## 发布

使用 Vercel 独立项目 `neptune-charge-hub`。仅发布经过核对的静态 `out/`，不上传本机环境、IndexedDB、备份、历史原型或账号。没有数据库、认证或工作流依赖。

2026-10-07 已完成首次静态正式发布，公开地址无需 Vercel 登录。发布使用 `scripts/prepare-static-deployment.mjs` 生成独立静态包，再通过 `scripts/vercel-cli.mjs deploy --cwd <生成的目录> --prebuilt --prod --yes` 发布；不要从源码根目录直接发布历史文件。

Android 与 iPhone 布局、加密数据流程和构建验证不能替代真机的安装、离线及定时执行验证。发布与测试结果见[变更记录](./CHANGELOG.md)。

## 基线与来源

项目位于 `D:\Workspace\projects\neptune-charge-hub`，与已经现场成功的[个人 Windows 工具](../neptune-charge-scheduler/README.md)独立。旧工具、加密账号、日志和 Windows 任务未修改。

前端由 Antigravity 以 `gemini-3.1-pro-high` 请求 Gemini 参与生成，模型目录没有3.5 Pro；调用证据与后续修订边界见[来源记录](./docs/gemini-frontend.md)。

旧云端原型已留本机可恢复记录；按用户最新要求，活动版本移除了云端登录、数据库与付款执行入口。此前创建的空白云资源未删除。分享给同学的是网页地址，各自创建本机空间。

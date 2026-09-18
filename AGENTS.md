# AGENTS.md — Typeless Update Feed Controller

## 适用范围

本文件适用于仓库根目录及其子目录。它是给智能代理的执行说明；实现和测试优先于旧文档或个人推测。

## 项目目标

本项目是一个本地 Node.js CLI，用于管理使用 `electron-updater` generic provider 的 Electron 应用更新源：

```text
应用 electron-updater → 127.0.0.1 本地清单服务 → 当前已安装版本
```

`freeze` 会备份应用包里的 `app-update.yml`，只改写顶层 `url`，然后由本机守护进程返回当前版本的清单。版本相同时，electron-updater 自己结束更新检查。

这不是通用网络拦截器，也不是 Typeless 数据代理。它不能控制模型、账号、配额、历史同步、遥测、数据留存或服务端最低版本策略。

## 真实实现边界

- 支持目标：`electron-updater` 配置文件；Sparkle 只识别和报告，不修改。
- macOS 配置：`Contents/Resources/app-update.yml`；版本优先读 `Info.plist`，必要时回退 `app.asar`。
- Windows 配置：`resources/app-update.yml`；版本读 `resources/app.asar`。
- 守护服务只监听 `127.0.0.1`，不默认修改 `/etc/hosts` 或 Windows hosts。
- 持久化状态位于 `~/.typeless-auto-update-block/`；Windows 为 `%LOCALAPPDATA%\\typeless-auto-update-block`。
- macOS 上的 Typeless 2.7.0 已做真实验证；Windows 只有代码和自动化测试，不能写成已实机验证。

## 必须保持的不变量

1. 不修改 `app.asar`、业务 JavaScript、可执行文件或模型提示词。
2. `freeze` 只允许改变 `app-update.yml` 的 `url`；其他顶层字段必须保持一致。
3. 原始配置必须逐字节备份；没有备份时不能宣称可还原。
4. 还原前检查当前配置的非 `url` 字段；发现新版本配置不一致时拒绝覆盖旧备份。
5. 缓存看守只处理记录过且目录名仍匹配的 updater cache `pending/` 文件，不能猜路径或清理无关目录。
6. 守护进程健康检查必须确认端口、状态目录和有效 PID；不能因为任意本地 HTTP 响应而杀进程或复用端口。
7. 无法读取安装版本时不得生成假版本清单。
8. 不把“当前更新检查显示已是最新”扩大表述为“无错误、无遥测、无数据上传、签名一定恢复”。

## 修改前的流程

1. 查看 `git status`、当前分支和最近提交。
2. 阅读相关 `src/` 文件和 `test/integration.test.mjs`，不要只依赖 README。
3. 判断修改是否会触碰已安装应用、LaunchAgent/Run 项、hosts 或其他外部状态。
4. 先用临时 fixture 或 dry-run 验证，避免用真实 Typeless 安装包做破坏性试验。

## 修改后的验证

```sh
npm test
node docs/assets/generate.mjs      # 修改图文案后运行
for f in docs/assets/*.svg; do xmllint --noout "$f"; done
git diff --check
```

如果修改了运行时状态或守护逻辑，再检查：

```sh
node src/cli.mjs status --json
node src/cli.mjs doctor
```

当前测试集应保持全部通过；新增逻辑要补充能验证风险的测试，不要只复制实现细节。

## 代码职责

| 文件 | 职责 |
| --- | --- |
| `src/cli.mjs` | 命令解析、状态输出、freeze/revert/repair/hosts/doctor |
| `src/discover.mjs` | 应用发现、更新源识别、版本和缓存路径 |
| `src/config.mjs` | 扁平 `app-update.yml` 解析、保留换行格式的单键替换、清单生成 |
| `src/patch.mjs` | 可写性检查、备份、补丁、旧备份保护、还原 |
| `src/daemon.mjs` | 回环 HTTP 清单、版本读取、漂移检查、缓存看守、通知限流 |
| `src/agent.mjs` | 稳定工具副本、Node 包装脚本、macOS LaunchAgent、Windows Run 项 |
| `src/asar.mjs` | 从 Electron `app.asar` 读取 `package.json.version` |
| `test/integration.test.mjs` | 临时应用、清单、补丁、端口、缓存和包装脚本测试 |

## 运行和清理规则

- `freeze` 后必须确认 daemon 已启动、feed 命中、应用配置正确；失败时不能留下“看起来已生效”的状态。
- 不要在后台留下自己启动的 daemon、测试服务器、浏览器或构建进程。
- 预览图、临时目录、生成缓存和无效构建产物完成后立即清理。
- `revert --all`、`agent uninstall` 后才能建议删除状态目录；直接删除可能让应用继续指向不存在的本地 feed。
- 不要主动删除用户已有数据或缓存，除非命令明确针对本工具记录的安全路径。

## Git 规则

- 默认只提交当前任务需要的文件，保持工作区干净。
- 未经用户明确要求，不重写历史、不强制推送、不删除远端标签或分支。
- 文档、SVG 和实现必须一起提交，避免 README 描述与代码脱节。
- 提交前确认 `git diff --check`、测试结果和最终 `git status`。

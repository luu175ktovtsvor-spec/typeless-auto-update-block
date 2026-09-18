# Typeless 更新源控制器

<p align="center">
  <sub>语言</sub><br>
  <a href="README.md">English</a> &nbsp;·&nbsp; <b>简体中文</b>
</p>

这是一个本地 CLI，用来管理 Electron 应用的 `electron-updater` 更新源。
它把应用包内 `app-update.yml` 的 `url` 备份后改到回环地址，再由本机守护进程返回“当前已安装版本”的清单。这样，应用自己的更新检查会得到 `update-not-available`，不会因为更新源返回新版本而自动下载或安装。

```text
应用的 electron-updater → 127.0.0.1 本地清单服务 → 当前已安装版本
```

项目名和仓库名不同：运行时目录、LaunchAgent 标签和 CLI 名称仍使用
`typeless-auto-update-block`，因为改这些标识会破坏已经安装的服务。

## 先看边界

- 工具会**修改应用包内的一个配置文件**。这不是无痕操作，macOS 代码签名可能失效，系统也可能重新询问权限。
- 它控制的是客户端更新检查，不控制 Typeless 的模型、账号、配额、数据上传或服务端最低版本要求。
- 它阻止的是通过更新源触发的自动下载与安装；你手动替换或升级应用后，守护进程会把新版本作为当前基线继续提供服务。
- 本仓库在 macOS 上用 Typeless 2.7.0（`now.typeless.desktop`）做过真实验证。Windows 路径有代码和自动化测试，但本次没有真实 Windows 验证。
- Sparkle 更新源只会被识别和报告，不会被修改。

如果你不能接受修改 `.app` / 应用目录，先不要执行 `freeze`。

## 工作流

| 步骤 | 命令 | 是否写入文件 |
| --- | --- | --- |
| 盘点 | `scan` | 否 |
| 预览 | `freeze <app> --dry-run` | 否 |
| 应用 | `freeze <app>` | 应用配置、备份、状态和服务文件 |
| 检查 | `status` / `doctor` | 只读 |
| 修复漂移 | `repair` | 只写应用配置 |
| 还原 | `revert <app>` / `revert --all` | 恢复备份并清理服务 |

## 工作原理

1. `discover` 在 macOS 应用包或 Windows 应用目录中查找 `app-update.yml`。
2. `freeze` 只替换顶层 `url`，写入前比较其他键，原文件逐字节保存到状态目录。
3. 本地服务只监听 `127.0.0.1`。它按请求中的应用标识读取当前版本（macOS 读 `Info.plist`，必要时回退 `app.asar`；Windows 读 `resources/app.asar`），生成一个版本相同的清单。
4. 守护进程每 20 秒检查配置是否漂移，并在已知的更新缓存 `pending/` 中清理文件。缓存目录名称不匹配时会跳过清理。
5. `revert` 用备份恢复原始 `url`。没有备份，或当前配置的其他键已经和备份不一致时，会拒绝写入，不猜测内容。

本地服务不接受局域网连接，也不会默认修改 `/etc/hosts`。`hosts add` 是单独的、需要管理员权限的宽范围网络规则，只有明确知道影响范围时才使用。

## 快速开始

要求：macOS 11+ 或 Windows 10+，Node.js 18+；运行库只使用 Node.js 标准库。

```sh
git clone https://github.com/luu175ktovtsvor-spec/typeless-auto-update-block.git
cd typeless-auto-update-block
node src/cli.mjs scan
node src/cli.mjs freeze Typeless --dry-run
node src/cli.mjs freeze Typeless
node src/cli.mjs status
```

执行 `freeze` 后重启目标应用一次。确认应用的更新检查和 `status` 都正常后，再长期保留后台服务。

Windows PowerShell 使用相同命令，只需把路径分隔符改成 Windows 写法：

```powershell
node src\cli.mjs scan
node src\cli.mjs freeze Typeless
node src\cli.mjs doctor
```

## 命令

| 命令 | 作用 |
| --- | --- |
| `scan [--dir a,b] [--json]` | 只读扫描 `electron-updater` 和 Sparkle 更新源 |
| `status [--json]` | 查看服务、端口、补丁状态和缓存统计 |
| `freeze <app> [--dry-run] [--pin <version>] [--no-guard-cache] [--port <n>]` | 备份并改写更新源，安装或刷新后台服务 |
| `repair [--json]` | 从当前终端权限重新写入本地更新源 |
| `revert <app>` / `revert --all` | 用备份恢复原配置 |
| `agent install\|uninstall\|status` | 管理 LaunchAgent 或 Windows Run 项 |
| `serve [--port <n>]` | 前台运行本地清单服务 |
| `hosts add\|remove <domain>` | 可选的 `/etc/hosts` 规则，需要管理员权限 |
| `doctor` | 检查 Node、服务、守护进程、补丁和最近的写入失败 |

`<app>` 可以是应用路径、显示名称或 Bundle ID，例如 `Typeless`、`now.typeless.desktop`。

`--pin` 只适合测试清单行为；如果指定版本高于本机版本，应用可能尝试下载一个本地并不存在的包，不应把它当作稳定的冻结方式。

## 如何确认生效

同时检查以下三项：

1. `node src/cli.mjs status` 显示 `frozen`，且 feed 为 `http://127.0.0.1:<port>/<slug>/`。
2. `~/.typeless-auto-update-block/logs/agent.log` 出现 `feed HIT`。
3. 应用自己的“检查更新”显示当前已是最新版本，并且更新缓存没有新增待安装载荷。

本机的 macOS 2.7.0 验证记录只代表这台机器、这个版本和这条更新链路，不代表所有版本或所有平台。

## 状态目录

macOS 为 `~/.typeless-auto-update-block/`，Windows 为 `%LOCALAPPDATA%\\typeless-auto-update-block`：

```text
app/                         后台服务运行的工具副本
bin/                         运行时解析 Node 的包装脚本
backups/<slug>/              原始 app-update.yml 与元数据
logs/agent.log               清单请求、重打补丁和失败记录
state.json                   端口、应用、缓存和通知状态
```

删除状态目录前，先执行 `revert --all` 和 `agent uninstall`。如果直接删除，目标应用仍可能指向已经不存在的本地服务。

## 风险与限制

- **代码签名**：写入应用包会使签名校验状态改变；`revert` 只能恢复文件内容，是否恢复系统信任还取决于系统的重新校验。
- **权限**：macOS 后台服务可能没有权限写入应用包。此时使用 `repair`，不要让守护进程反复重试。
- **服务端强制升级**：后端如果拒绝旧客户端，应用仍可能无法正常工作。
- **更新配置漂移**：重装或应用自身改写配置后，守护进程最多在下一个 20 秒周期重新写入；这不是竞态免疫保证。
- **升级后的还原**：如果新版本改变了 `app-update.yml` 的其他字段，工具会拒绝用旧备份覆盖它；先确认新配置，再重新 `freeze`。
- **平台验证**：Windows 的实现已覆盖发现、路径、包装脚本和清单逻辑，但需要真实 Windows 机器补充验收。
- **数据边界**：本工具不改变 Typeless 的语音、上下文、历史同步、遥测或模型请求。

## 还原与开发

```sh
node src/cli.mjs revert --all
node src/cli.mjs agent uninstall
node --test
node docs/assets/generate.mjs
```

代码职责见 [docs/architecture.md](docs/architecture.md)，Typeless 2.7.0 的只读分析见 [docs/typeless-technical-analysis.md](docs/typeless-technical-analysis.md)。图表由 [docs/assets/generate.mjs](docs/assets/generate.mjs) 生成，修改文字后重新运行即可。

## 许可

MIT，见 [LICENSE](LICENSE)。

# Typeless Update Feed Controller

<p align="center">
  <sub>Language</sub><br>
  <b>English</b> &nbsp;·&nbsp; <a href="README.zh-CN.md">简体中文</a>
</p>

A local CLI for managing an Electron app's `electron-updater` feed.
It backs up the app's `app-update.yml`, changes only its `url` to a loopback feed, and runs a local daemon that returns the installed version. The app then receives `update-not-available` from its normal update path instead of downloading and installing a newer feed result.

```text
app electron-updater → 127.0.0.1 feed → installed version
```

The repository is named `typeless-auto-update-block`, and the installed state directory, LaunchAgent label, and CLI keep that name for compatibility with existing installations.

## Read this before running it

- The tool **modifies one file inside the app bundle**. This can invalidate a macOS code signature and can cause permissions to be requested again.
- It controls the client update path only. It does not control Typeless models, accounts, quotas, data transfer, telemetry, or server-side minimum versions.
- It prevents update downloads and installs caused by the feed. If you replace or upgrade the app yourself, the daemon follows the newly installed version as the new baseline.
- Typeless 2.7.0 (`now.typeless.desktop`) was verified on macOS. The Windows path has code and automated coverage, but has not been exercised on a real Windows machine in this release.
- Sparkle feeds are detected and reported, not patched.

Do not run `freeze` if modifying an `.app` or installed application directory is unacceptable for your setup.

## Workflow

| Step | Command | Writes files? |
| --- | --- | --- |
| Inspect | `scan` | No |
| Preview | `freeze <app> --dry-run` | No |
| Apply | `freeze <app>` | App config, backup, state, and service files |
| Check | `status` / `doctor` | Read-only |
| Repair drift | `repair` | App config only |
| Restore | `revert <app>` / `revert --all` | Restores the backup and removes the service when empty |

## How it works

1. `discover` finds `app-update.yml` in macOS bundles or Windows app directories.
2. `freeze` replaces only the top-level `url`, verifies that other keys are unchanged, and stores a byte-exact backup.
3. The daemon listens on `127.0.0.1` only. For each request it reads the installed version (macOS: `Info.plist`, with an `app.asar` fallback; Windows: `resources/app.asar`) and builds a same-version manifest.
4. Every 20 seconds it checks for feed drift and can remove files from a recorded updater cache's `pending/` directory. A cache whose directory name no longer matches the recorded name is left alone.
5. `revert` restores the original URL from the backup. If the backup is missing or other keys no longer match, it refuses to write instead of guessing.

The default path does not edit `/etc/hosts` or expose a LAN service. `hosts add` is a separate administrator-only, broad network rule and should be used only when its scope is understood.

## Quickstart

Requirements: macOS 11+ or Windows 10+, Node.js 18+, and no third-party runtime dependencies.

```sh
git clone https://github.com/luu175ktovtsvor-spec/typeless-auto-update-block.git
cd typeless-auto-update-block
node src/cli.mjs scan
node src/cli.mjs freeze Typeless --dry-run
node src/cli.mjs freeze Typeless
node src/cli.mjs status
```

Restart the target app once after `freeze`. Keep the background service only after `status` and the app's own update check look correct.

On Windows PowerShell, use the same commands with Windows path separators:

```powershell
node src\cli.mjs scan
node src\cli.mjs freeze Typeless
node src\cli.mjs doctor
```

## Commands

| Command | Purpose |
| --- | --- |
| `scan [--dir a,b] [--json]` | Read-only scan for `electron-updater` and Sparkle feeds |
| `status [--json]` | Show service, port, patch, and cache state |
| `freeze <app> [--dry-run] [--pin <version>] [--no-guard-cache] [--port <n>]` | Back up and rewrite the feed, then install or refresh the service |
| `repair [--json]` | Re-apply the local feed from the current shell permissions |
| `revert <app>` / `revert --all` | Restore the original configuration |
| `agent install\|uninstall\|status` | Manage the LaunchAgent or Windows Run entry |
| `serve [--port <n>]` | Run the local manifest service in the foreground |
| `hosts add\|remove <domain>` | Optional `/etc/hosts` rule; requires administrator access |
| `doctor` | Check Node, service, daemon, patch, and recent write failures |

`<app>` may be an app path, display name, or bundle ID such as `Typeless` or `now.typeless.desktop`.

`--pin` is for manifest testing. If it is newer than the installed version, the app may try to download a package that does not exist locally; it is not the normal freeze path.

## Verifying the result

Check all three:

1. `node src/cli.mjs status` reports `frozen` and a feed under `http://127.0.0.1:<port>/<slug>/`.
2. `~/.typeless-auto-update-block/logs/agent.log` contains `feed HIT`.
3. The app's own update check reports that it is current, and its updater cache has no new pending payload.

The macOS 2.7.0 result is evidence for that machine, build, and feed path; it is not a claim about every version or platform.

## State directory

macOS uses `~/.typeless-auto-update-block/`; Windows uses `%LOCALAPPDATA%\\typeless-auto-update-block`:

```text
app/                         stable tool copy used by the service
bin/                         runtime Node wrapper
backups/<slug>/              original app-update.yml and metadata
logs/agent.log               feed hits, re-applies, and failures
state.json                   ports, apps, cache, and notification state
```

Before deleting the state directory, run `revert --all` and `agent uninstall`. Removing it first can leave an app pointing at a feed that no longer exists.

## Risks and limits

- **Code signing:** changing a file in an app bundle changes its signature state. `revert` restores file contents; the operating system may still need to revalidate the app.
- **Permissions:** a macOS background service may not be allowed to edit an app bundle. Run `repair` from a permitted shell instead of relying on repeated retries.
- **Server enforcement:** a backend can reject an old client even when the local feed says it is current.
- **Feed drift:** after reinstall or an app self-rewrite, the daemon may re-apply the URL on its next 20-second cycle; this is not a race-free guarantee.
- **Restore after an upgrade:** if a new build changes other `app-update.yml` keys, the tool refuses to overwrite them with an old backup. Confirm the new configuration and re-freeze deliberately.
- **Platform evidence:** Windows discovery, paths, wrapper, and manifest logic have automated coverage but need real-machine acceptance.
- **Data boundary:** this tool does not change Typeless audio, context, history sync, telemetry, or model requests.

## Restore and development

```sh
node src/cli.mjs revert --all
node src/cli.mjs agent uninstall
node --test
node docs/assets/generate.mjs
```

See [docs/architecture.md](docs/architecture.md) for the implementation map and [docs/typeless-technical-analysis.md](docs/typeless-technical-analysis.md) for the read-only Typeless 2.7.0 analysis. Diagrams are generated by [docs/assets/generate.mjs](docs/assets/generate.mjs).

## License

MIT; see [LICENSE](LICENSE).

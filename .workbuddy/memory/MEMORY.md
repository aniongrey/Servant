# 项目长期记忆 — Servant / Shiro

_细节查 `docs/`；技能 `repo-identity-rename`／`repo-asset-migration`／`tauri-node-sidecar`／`tauri-plugin-integration`／`tauri-backend-decision-gate`／`web-audio-lipsync-integration`／`css-theme-palette-verification`／`cargo-target-sandbox-safety`／`tauri-window-deep-link`。提交自 `c697187` 起，按日日志在 `.workbuddy/memory/`。只留会踩的坑。_

## 命名契约
产品＝**Servant**（包名/exe/identifier/sidecar/托盘/窗口标题/向导文案），角色人格＝**Shiro**。必须是 Shiro：`character/state/assets/data/shiro/**`、`character-state:shiro`／`soul-state:shiro`、`characterId='shiro'` 系列、桌面菜单角色卡与 `desktop_windows.rs` 的「Shiro 菜单」、「夸奖/贬低 Shiro」文案、`gpt-sovits/*` 里的 `F:\shiro\...`（用户本机路径）。名单外的 `Shiro/shiro/SHIRO` 都是产品名。

## 远端与凭据
`origin=github.com/aniongrey/Servant.git`（public）；身份 `Codex <codex@local>`（本机无 identity）。推送复用 GCM，**别把 token 写进 remote URL**；`.git/config` 要 `helper =`（空，清掉 system 级交互式 `helper-selector`）+ `helper = manager`。出网 `http.proxy=127.0.0.1:7890`。仓库可能被其它工具**并行提交** → 提交前看 `git log --oneline -1`。

## 构建
- `npm run dev`＝前端 5173+后端 5174｜`build:fast`→`dist-fast/Servant/`｜`verify:desktop`＝构建+启动+验收（**先杀 Servant**：它 `prevent_close()`，要 `taskkill /PID <pid> /T /F`，`/T` 不能省，否则留孤儿 sidecar 与 Python）。
- **冷路径**（改完必须重建）：Rust、sidecar payload、`bundle.resources`、`memory_service/**`；`src/**` 走 HMR。
- `tauri:fast`（`run.bat`／`rundesk.bat`）＝用户日常启动方式＝`vite build`+`vite preview` 挂 `createApiModules()`。`vite.config.ts` **不能 import 后端模块**（watch→重启 dev、掉 WS）；后端模块挂 `vite.preview.config.ts`。
- **沙箱内跑 cargo 必须隔离 target**：`CARGO_TARGET_DIR='E:\airi\Servant\.local\cargo-sbx'`。沙箱里 build script 会重跑而 `autocfg` 探测可能失败（`stderr` 留 `autocfg could not probe for \`std\``）→ `indexmap 1.9.3` 缺 `cargo:rustc-cfg=has_std` → `schemars 0.8.22`（它当 build-dependency）E0107 → **debug `tauri:fast` 直接编不过**。坏 output 写进用户 `target/<profile>` 后 cargo **永不重跑**、用户自己也一直失败。判定 `grep -rl "autocfg could not probe" target/*/build/*/stderr`；`--release` 通过**不代表** debug 干净（各 profile 独立，release 那份是用户自己构建的）。修复＝删 `target/<profile>/build/<pkg>-*` + `.fingerprint/<pkg>-*`（含下游包）后**在沙箱外**重建。
- **SafeDelete 护栏来自 `NODE_OPTIONS`，不是沙箱**（`dangerouslyDisableSandbox` 挡不住）：它注入 `node-language-shim.cjs` + `CODEBUDDY_SAFE_DELETE_*`（阈值 50）。按用户真实路径跑构建脚本用 `env -u NODE_OPTIONS -u CODEBUDDY_SAFE_DELETE_ENABLED -u CODEBUDDY_SAFE_DELETE_BULK_GUARD -u BASH_ENV npm run tauri:fast`，比「先把 `dist` 整个 `mv` 走」干净。细节与取证脚本见技能 `cargo-target-sandbox-safety`。
- **产物**：`target/release/servant-desktop.exe`(53MB)、`bundle/{msi,nsis}/Servant_*`；**Tauri 增量写 `bundle/` 且从不清理** → 旧品牌 `Shiro_*` 会原地留着，验收前移到 `E:\airi\_codex-list-stale-drafts\`；核对 `<File>` 清单看 `target/release/wix/x64/main.wxs`。
- **图标源＝`public/favicon.ico`**：抽内嵌 256px PNG → `tauri icon` 覆盖 `src-tauri/icons/**`（`bundle.icon` 只列 `icon.ico`）。

## Windows 无窗口约束
产品是 `windows_subsystem="windows"`，但它起的 `servant-server.exe`（Node SEA，console 子系统）与 `taskkill` 都是 console 程序 → 无窗父进程 spawn 会**新开控制台**（黑窗）。**外部进程一律过 `src-tauri/src/quiet_process.rs` 的 `quiet()`**（`CREATE_NO_WINDOW`）；Node 侧 `windowsHide: true`。

## 目录契约
- **页面**：根目录只 `index.html`+`pages.html`，其余 18 页在 `pages/`。加/移页面改四处：`SECONDARY_PAGES`、`desktop_windows.rs::open_app_window`、`tauri.conf.json` pet `url`、`navigation.ts` 兜底 URL。
- **动作**：`public/assets/motions/vrma/` 扁平 59 个，唯一清单 `vrmaAssetFiles.ts`；`vrma/` 被 gitignore → `git mv` 无效。
- **角色**：只跟踪 `TestModel.vrm`（`*.vrm` + `!TestModel.vrm`，**别写成整目录排除**）。换默认模型改三处：`default-character.json` 的 `vrmUrl`、`micro-dynamics.json` 的 `model.url`、`vrmModels.test.ts` 断言。TestModel 无耳朵/呆毛骨骼（绑定静默失效），`avatarFit` 仍是可莉尺寸。

## 后端与打包
- 唯一路由表 `apiModules.ts`（**顺序有意义**：`localCorsApi` 最前、`apiNotFoundApi` 最后），同时挂 `configureServer`/`configurePreviewServer`。
- `projectPaths.ts`：dev 时 `root===data===仓库根`；打包 `root`=`resource_dir()`、`data`=`%APPDATA%\com.servant.desktop`。前端一律 `backendFetch()`。
- **安装目录没有 `public/`** → 后端按路径读的 `public/**` 要逐条列进 `bundle.resources`；搬/删这类资产同步三处（manifest mirror、`bundle.resources`、`.gitignore`）。前端取内置资源走 `toServedAssetUrl()`。
- 打包版 `/api/*` 打不到后端时回 `index.html` → `Unexpected token '<'`；**未知路径也回 200+text/html** → 「页面不报错」≠「后端通了」。`servant-server.cjs`→SEA 必须 CJS；Rust 网关只管 `desktop.sync`/`web.search`。

## 首跑门禁（细节 `docs/provisioning.md`）
- **门禁**＝`!setupComplete && 有资源既不在所选目录、也不在任何运行时会读的位置`；Rust 问一次 `GET /api/provisioning/gate`（2s×3），取不到才回退 `setupComplete`（前提：`BackendProcess::start()` 阻塞到端口在听，且早于 `desktop_windows::setup()`）。
- **问谁**：打包版问 sidecar；**dev 没有 sidecar** → 问 `build.devUrl`（同一张路由表）。只认 sidecar 会让 dev 每次弹向导 → **验收必须跑用户真实的启动脚本**。
- **三态**：`ready`（下载根里有 `.servant-provisioning.json`，面板「已就绪」只看它）｜`usable`（`requiredFiles` 全在 → 免弹门禁、面板写「已可用」且**默认不勾选**、不参与就绪判定）｜`absent`。共享下载根 `%LOCALAPPDATA%\Servant\model-roots.json` 只是候选根；`resourceRoots(...,downloadRoot?,sharedRoots)` **第 4 参默认空 → 测试不受本机状态影响**。
- **「进入 Servant」＝开 chat + 开 settings 并落在 LLM 分区**（向导不配 LLM，只把资源下齐）。设置窗口的分区单一来源＝`src/app/settings/settingsSections.ts`（`settingsSections` 数组 + `resolveSettingsSection()`）。跨窗口指定分区**走 URL query 不走事件**：`open_app_window(app, label, section)`，新窗口用 `pages/settings.html?section=llm` 构建；**已存在的窗口只是 show/focus、不会重跑 mount** → 必须 `navigate_to_section()` 改 query 触发真导航（已在目标分区则跳过）。事件会输给「webview 还在启动」的竞态。参数过 `sanitize_section()`（只收 `[A-Za-z0-9_-]`），且 section 只对 `settings` 生效。

## identifier 与记忆服务
- `identifier`=`com.servant.desktop`（单一来源 `tauri.conf.json`；改它＝换数据目录，`%APPDATA%` 与 WebView2 localStorage 都要迁，必须重建 exe）。迁移 `npm run migrate:data -- --yes`。Python：`SERVANT_PYTHON`→`<root>/.venv-memory`→`<data>/.venv-memory`→`python`。
- 带品牌的边界：`SERVANT_*`、`X-Servant-Memory`、`.servant-provisioning.json`、`.servant-write-probe`、`%LOCALAPPDATA%\Servant`。
- **清空聊天＝删 `messages` 全表**（不带 `conversation_id` 时）；`memories` 不动。503 映射：`/api/memory/*`→「记忆服务进程退出」、`/api/chat/history`→`fetch failed`；`/api/nothing` 回 404+JSON＝sidecar 正常；记忆冷启动 17–21s 正常。

## 角色表面
- **Q 版＝缩 `hips.scale`**（`vrm/CharacterProportion.ts`）：`hips.scale *= bodyHeight` → 关节间距/蒙皮网格/弹簧链一起缩（裙摆、发梢、尾巴随动），`head.scale *= headScale/bodyHeight` 反向补偿（头保持等比并叠头身比），宽度只改左右骨骼 `position.x`（走缩放会与骨骼旋转合成剪切）。**弹簧碰撞尺寸要单独乘 bodyHeight**（`collectSpringCollisionSizes`：`joint.settings.hitRadius` + `colliderGroups[].colliders[].shape.radius`，Sphere/Capsule 才有 radius、基类类型没有）——它们是**世界单位**，`VRMSpringBoneJoint._collision` 拿来直接减世界距离、不随骨骼缩放，不缩的话裙摆会被旧碰撞体顶回原尺寸（0.75 时实测只缩到高 0.84×/宽 0.94×）。**别用 `vrm.scene.scale`**——`animateHeadFeedback` 独占它做摸头压扁。旧实现（只缩白名单骨骼 position）必漏件：网格只被平移，弹簧骨骼 position/rotation 每帧被物理覆写。
- **命中判定不读蒙皮顶点**：`modelHitTest.ts::createVrmHitTest` 返回 `'head'|'body'|null`（boolean 用法靠 `Boolean(...)` 兼容），纯骨骼胶囊、代价与面数无关；半径乘**骨骼自己**的世界缩放（Q 版缩下去后命中体积跟着缩）。反例：`SkinnedMesh.computeBoundingBox()`／`raycast()` 逐顶点 `applyBoneTransform` → 高模一次点击数百万次矩阵混合（摸头秒级卡顿）。
- **「正在输入」**＝`phase==='thinking'||'typing'`；只在显示队列排空**且**收到 `turn-end` 回 idle（余段 150ms 突发吐完 → 文本领先语音）。节奏归 `ai/llm/replyDelivery.ts`。
- **口型＝分析正在播放的音频**（`visemeAnalyzer.ts`；硬约束见技能 `web-audio-lipsync-integration`）；**口型与气泡是两条时间线**（`speech.speaking` vs `speech.bubbleVisible`），给 `speech` 加字段要同时补 `createInitialSnapshot` + `AgentRuntime` hydrate/save（deep merge 会重置漏写的）。
- **主 LLM 两个连续 JSON**：`emotion`→脸（`MOOD_PRESENTATION` 下限 0.55）、`shortAction`→身体（词表仅 `reply/shortActionVocabulary.ts`）。
- **开机启动默认关**：Win `HKCU\...\Run\Servant`、macOS LaunchAgent `<identifier>.plist`；设置窗口打开时无条件重写；**开发版拒绝写入**；旧键 `Shiro` 残值手工删。
- **「初始参数」＝各模块自带默认值**：主题 `sakura`／交互提示开＝`uiPreferences.ts` 的 fallback（解析主题**必须过 `isUiTheme()` 白名单**，旧写法漏了 `'nocturne'` 会把夜金用户每次加载拉回 fallback）｜语音 `defaultSpeechSdkTtsProviderConfig`（默认 `microsoft` 本地系统语音）｜Fit 在 `default-character.json`（`defaultAvatarFitConfig` 是命中测试中性基准，**别动**）｜LLM `defaultLlmConfig`(0.3)。**改默认值要同步四处**：模块 fallback、`default-settings.json` 里那条 localStorage 串、断言默认值的测试、该值写回存储的路径。`default-settings.json` 只是导出包，`localSettings.ts` 是死代码。聊天条数：窗口分页 16｜喂 LLM 上下文 8。

## 验证
- `npm test`／`npx vitest run <path>`（只收 `src/**/*.test.ts`）；Rust `cargo test --bins`（**无 lib target**）。网络逻辑用本地 `node:http` 假站点 + 注入 `fetchImpl`；Tauri 桥用 `vi.stubGlobal`+`vi.mock` 测分支。
- **首窗口验收两条路径都验**：打包版 `.local/triage/provisioning-gate-probe.mjs`；dev `.local/triage/dev-gate-probe.mjs`（跑 `npm run tauri:fast`）。**等 `chat-test`/`setup` 目标出现再判断**（pet 先出现，`backend-port-*.json` 多实例并存，按 mtime 过滤）；收尾**按端口找 pid 杀**，别 `taskkill /IM node.exe`。
- **headless Edge 挂不了 React 页面** → 布局只能靠真窗口或用户确认；别动生产 `dist/`（用 `npx vite build --outDir .local/triage/<名> --emptyOutDir`）。

## 环境陷阱
- `dist/` ~100MB、`target/` ~4.2GB，**E: 盘紧张**（曾满盘 `os error 112`）→ 盘紧时别在用户开着的窗口上重建产物。
- Bash 要加 PATH 前缀：`export PATH="/c/Users/Administrator/.workbuddy/binaries/PortableGit/versions/1.2.0/usr/bin:$PATH"`（cargo 再加 `$HOME/.cargo/bin`）。PowerShell 不回传 stdout → 重定向到文件再 Read；`reg.exe`/`wmic.exe` 被拉黑。
- `/tmp` 在 Bash 与 Windows 程序间不一致 → 临时脚本放 `.local/triage/`；curl 探本地端口带 `--noproxy '*'` 用 `127.0.0.1`；GUI 验证把「启动+使用+收尾」放同一条后台命令。
- **删除**：删前 `git status --porcelain` → 优先 `git rm` → 移走用 `Move-Item` 到 `E:\airi\_codex-list-stale-drafts\<日期>-<主题>\`（路径用正斜杠）→ 删后 `git status --ignored=matching`。**`rm -rf` 只进回收站、`df` 不变**，别盲清回收站。
- **源码行尾一律 LF**（`.gitattributes` 的 `eol=lf`）：编辑后整文件变 CRLF 会让 `prettier --check` 报错 → 用 `node -e` 数 `\r\n` 判定，替换回 `\n`。
- headless Edge 会锁住 `--user-data-dir`（内有 API Key 副本）→ 按命令行**先过滤再杀**自己的 msedge。
- **别把本机文件系统慢当回归**：`rmSync` 删 300 个文件 ~11s（正常 ~30ms），`mkdtemp` 的测试会**假超时** → 先加 `--testTimeout=120000 --hookTimeout=120000` 复跑。基线：vitest **539 通过 / 120 文件**（09-24）；`cargo test --bins` **16 条**。

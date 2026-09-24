# 初始化面板与按需资源下载

安装包只带「运行外壳」：需要模型的功能（语音识别、长期记忆）在首次启动时把模型下载到**用户选定的目录**。
本文是该子系统的唯一参考：契约、存储位置、站点切换和扩展方式。

## 面板只做一件事：下载资源

`pages/setup.html` 上的面板是一屏，不是多步向导：

1. **下载源**（`ModelScope 魔搭` / `HF 镜像` / `HF 官方`）——队首是用户的选择，其余是自动回退链；
2. **下载位置**——可编辑的绝对路径 + 「选择目录」（原生选择器），留空则用 `<应用目录>/models`；
3. **资源清单**——直接来自服务端清单，勾选要下载的，点「开始下载」。

三点刻意的设计：

- **不在面板里配 LLM / TTS**。大模型供应商、API Key、音色属于设置窗口，初始化阶段只解决
  「缺文件」这一件事；把两件事塞进同一屏只会让首跑变长。
- **不列随包提供的东西**。清单里只有「需要下载的」，Python 记忆环境、sherpa-onnx WASM 运行时
  都不出现——它们没有可准备的东西，列出来只会让用户以为漏了什么。
- **功能开关由资源推导**（`featuresFromResources`）。对话与语音合成不需要本地模型，恒为开；
  `stt` / `memory` 跟着对应资源走，所以「只下载资源」就是对「启用了什么」的完整回答。

另外：**已经在别处可用的资源默认不勾选**（`availableElsewhere`，见「就绪判定」）。勾选它等于为了
把文件搬进所选目录而重下 1.4GB，所以默认让它安静地待着，卡片上写明文件在哪里、想搬再勾。

## 分层

| 层 | 文件 | 职责 |
| --- | --- | --- |
| 首跑门禁 | `src/app/network/server/provisioningGate.ts` + `src-tauri/src/provisioning_gate.rs` | 判定「还需不需要初始化」：状态文件已标记完成，或每个资源都已在运行时会读的位置 → 不开初始化窗口 |
| 共享模型根 | `src/app/network/server/sharedModelRoots.ts` | `%LOCALAPPDATA%\Shiro\model-roots.json`：同一用户所有 Shiro 构建互认下载根（候选，不是权威） |
| 存在性判断 | `src/app/network/server/resourcePresence.ts` | `ready`（所选目录里有完成标记）/ `usable`（运行时要读的文件在）/ `absent` |
| 共享契约 | `src/app/provisioning/provisioningTypes.ts` | 无 DOM / Node API，前后端共用：路由前缀、状态归一化、站点枚举、资源 id 常量 |
| 面板 | `src/app/provisioning/SetupWizard.tsx` + `provisioningClient.ts` + `featureCatalog.ts` | 站点选择、目录输入、资源勾选、进度与换源重试 |
| 资源清单 | `src/app/network/server/resourceManifest.ts` | 「能下载什么」的唯一真相；**只在服务端**，前端只看到 id / 名称 / 体积 |
| 存储位置 | `src/app/network/server/provisioningStore.ts` | 状态读写、下载根目录解析、可写性探测、共享根的发布 |
| 模型仓库 | `src/app/network/server/modelRepository.ts` | 站点注册表 + 整仓库拉取（列文件 → 过滤 → 逐个流式下载 → 写完成标记） |
| 下载原语 | `src/app/network/server/resourceDownloader.ts` | 单文件流式落盘、`.download` 临时文件 + rename 原子替换、可选 fetch 注入 |
| 资源读取 | `src/app/network/server/provisioningAssets.ts` | 把下载目录里的文件按安全路径解析出来，供 webview 通过后端读取 |
| 后端 API | `src/app/network/server/provisioningApi.ts` | `gate` / `state` / `resources` / `download`(SSE) / `assets` 五条路由 |

## 首跑门禁：什么时候不再弹初始化

桌面壳启动时只问一句「还需不需要初始化」（`GET /api/provisioning/gate`），规则在
`provisioningGate.ts`：

```
setupRequired = !setupComplete && 至少一个资源既不在所选目录、也不在任何运行时会读的位置
```

两条分支各自守住一件事：

- **`setupComplete` 优先**。它是「用户做过决定」的记录：初始化时故意跳过语音识别的人，
  不能每次启动都被重新问一遍。这一条从旧版沿用。
- **磁盘的意见同时算数**。只要模型文件确实在（所选下载目录、`mirrors`、共享模型根），
  就没有可准备的事 —— 让一个已经有 1.4GB 模型的机器再下载一遍是撒谎。

> 为什么要从 Rust 挪到后端：旧版门禁读的是数据目录里的 `provisioning-state.json` 的
> `setupComplete`，而那个文件是**按构建隔离**的（`npm run dev` 写进仓库根，打包版写进
> `%APPDATA%\<identifier>`）。在同一台机器上先用开发版下完模型、再开打包版，打包版既看不到
> 状态文件、也没有任何地方记着模型在哪，于是每次启动都要求重新下载。判别需要资源清单，
> 而清单只在服务端，所以结论也由服务端给。

Rust 侧（`provisioning_gate.rs`）只做一次**短超时**（2s、最多 3 次）的 loopback GET，问到**正在服务这个 UI 的那个后端**：

| 启动方式 | 后端在哪 | Rust 问谁 |
| --- | --- | --- |
| 打包版 | 自己的 sidecar | `BackendProcess` 握手拿到的端口 |
| `npm run tauri:fast` / `npm run dev` | Vite 把同一张路由表挂在页面 origin 上，**没有 sidecar** | `build.devUrl`（就是那个 Vite 服务器） |

它不冷启动任何东西：`main.rs` 先 `BackendProcess::start()`（内部等到端口在听）才调用
`desktop_windows::setup()`；开发路径的 Vite 服务器则由 `beforeDevCommand` 在应用起来之前拉好。

> **踩过的坑**：最初只写了 sidecar 那一种，开发构建因此直接掉进回退分支。而回退读的是
> `%APPDATA%\<identifier>\provisioning-state.json` —— 开发版根本不往那儿写（`projectPaths` 在开发下
> `data`＝仓库根），文件不存在 → `setupComplete=false` → **`run.bat` 每次启动都弹初始化**。
> 打包版反而是好的，于是「验收打包版 exe」把这个问题整个漏掉了。**验收必须走用户真正用的启动方式。**

只有两种情况会回退到旧的 `setupComplete` 标记：`devUrl` 缺失（非 http 页面源），或后端确实不答话。
回退是最后手段而不是常规路径 —— 那个标记只代表「这个构建的数据目录里做过初始化」。

资源在不在，由 `resourcePresence.ts` 判定，比「目录存在」严格、比「完成标记」宽松：

| 判定 | 含义 | 谁看 |
| --- | --- | --- |
| `ready` | **所选下载根目录**里有完成标记：这次拉取跑完了 | 面板的「已就绪」；只有它能免掉「待下载」 |
| `usable` | 运行时要读的文件（`requiredFiles`）都在 | 门禁（有它就不弹）；面板显示「已在 X 可用」 |
| `absent` | 上面两条都不成立（含只下了一半的目录） | 门禁据此要求初始化 |

`requiredFiles` 是逐文件检查的，所以 `model.int8.onnx` 在、`tokens.txt` 不在的目录**不算**可用。

## 以仓库为单位拉取

清单只写仓库名（`pengzhendong/sherpa-onnx-sense-voice-zh-en-ja-ko-yue`），文件列表在下载时向站点查询。

> 为什么不能手写文件列表：早期版本在清单里手写 7 个文件名，而 `Qwen/Qwen3-Embedding-0.6B`
> 实际有 **13** 个，漏掉 `vocab.json`、`merges.txt`、`1_Pooling/config.json` 等 —— 分词器会直接不可用，
> 而下载过程本身不会报任何错。按仓库拉取让文件列表不可能漂移。

### `include` 允许清单

仓库常带我们永远不加载的变体，所以 `ModelRepoRef.include` 是必需的：

- `pengzhendong/sherpa-onnx-sense-voice-zh-en-ja-ko-yue` 里除了 228.2 MiB 的 `model.int8.onnx`，
  还有 **894.2 MiB 的 float32 `model.onnx`** —— WASM 运行时从不用它。
  `include: ['model.int8.onnx', 'tokens.txt']` 让这 894 MiB 根本不上网。

  实测该仓库共 **7** 个文件 / 1122.6 MiB，`include` 之后**会请求 2 个** / 228.5 MiB：

  | 仓库文件 | 大小 | 是否下载 |
  | --- | --- | --- |
  | `model.int8.onnx` | 228.2 MiB | ✅ |
  | `tokens.txt` | 0.3 MiB | ✅ |
  | `model.onnx`（float32，运行时不加载） | 894.2 MiB | ❌ 被 include 挡掉 |
  | `.gitattributes` | 1.6 KB | ❌ 与运行无关 |
  | `configuration.json` / `LICENSE` / `README.md` | 各 < 1 KB | ❌ 与运行无关 |

  > **单位**：以上是站点上报的 MiB。换算成十进制 MB 时 `model.onnx` 是 937 MB、`model.int8.onnx`
  > 是 239 MB、仓库合计 1177 MB —— 两组数字说的是同一批文件，别当成两套。
  > 面板里的数字走 `formatBytes()`（1024 进制却标成 `MB`），所以同一份文件面板显示 228.5 MB、
  > 站点 API 上报 239,549,735 字节 —— 也是同一个东西。

  **「只下 2 个」说的是「7 个里只有 2 个会被请求」，不是「仓库只有 2 个文件」**：未下载的 5 个要么
  永远不加载（float32 权重），要么与运行无关（git 元数据 / 说明 / 许可）。运行时另外需要的
  `silero_vad_v5.onnx` / `silero_vad_legacy.onnx`（Silero VAD）**不在任何 SenseVoice 模型仓库里**，
  它们来自 sherpa-onnx 发行包，由安装包内置、经 `bundle` mirror 提供给资产路由 ——
  这也是 loader 必须保留「退回 worker 同目录同名文件」这条路的原因。

匹配规则（`repoPathMatches`）刻意做得很小：`*` 与 `?` 不跨 `/`，`**` 跨任意层级，
`**/` 可以匹配零层目录（`**/*.json` 也匹配顶层的 `config.json`）。过滤发生在**列文件之后、请求任何字节之前**，
所以「这次要下多少」的答案是准的、进度总量也是准的。

过滤后为空会单独报「include 过滤后为空（配置错误）」而不是混进「所有站点都失败」——
那是清单写错，不是网络问题。

### 只下 2 个文件为什么够（实测）

下载完成后 `sherpa-asr/` 里只有 `model.int8.onnx` + `tokens.txt`（外加完成标记），
而隔壁记忆模型有 14 个文件。这**不是漏文件**，两种资源的加载方式根本不同：

- **记忆模型是 Python 侧按目录加载的自包含模型**：`config.json`、`tokenizer.json`、
  `merges.txt`、`vocab.json`、`model.safetensors` 缺任何一个都起不来，所以整仓都要。
- **SenseVoice 走 WASM，worker 是把单个文件 mount 进虚拟文件系统**，仓库只需提供权重与词表。

识别一次说话需要的东西分三类，只有第一类来自下载：

| 类别 | 文件 | 来源 |
| --- | --- | --- |
| 权重 + 词表（2） | `model.int8.onnx`、`tokens.txt` | **模型仓库 → 下载目录** |
| Silero VAD（2） | `silero_vad_v5.onnx`、`silero_vad_legacy.onnx` | sherpa-onnx 发行包 → `public/engines/sensevoice/` |
| 引擎（5） | `offline-worker.js`、`audio-input-worklet.js`、`sherpa-onnx-{asr,vad}.js`、`sherpa-onnx-wasm-main-vad-asr.{js,wasm}` | 随应用提供 |

后两类**不由任何模型仓库提供**，下载目录里没有它们是正常的。**安装包里一份模型都没有**
——`public/models` 已整目录移除，运行时目录约 17MB，只含引擎与两个 VAD 导出。

实测方式见 `docs/verification.md`（无头 Edge + 纯 HTML 探针）：运行时目录对
`model.int8.onnx` / `tokens.txt` 一律 404（它本来就没有这两份），只留下载目录那一份，
再启动真实 worker。结果 `{ok:true,type:'ready'}`，服务端日志给出解析顺序：

```
200 ASSET/DOWNLOAD model.int8.onnx        239233841   <- 用户下载目录
200 ASSET/DOWNLOAD tokens.txt             315894      <- 用户下载目录
200 ASSET/MIRROR   silero_vad_v5.onnx     2327524     <- public/engines/sensevoice
200 ASSET/MIRROR   silero_vad_legacy.onnx 1807522     <- public/engines/sensevoice
```

即「这 2 个文件 + 应用自带的引擎与 VAD」足以把识别器建起来。这同时回归了两件事：
worker 必须读 `init.assets`（模型是从资产路由取到的，说明页面传过去的 URL 真被用了），
以及下面的数据包跳过逻辑。

### `.data` 预载包：为什么不发布、怎么跳过

官方发行包里的 `sherpa-onnx-wasm-main-vad-asr.data` 约 **229MB**，内容是模型的重复副本。
它的 emscripten 元数据（写在 `sherpa-onnx-wasm-main-vad-asr.js` 里）是：

```
[/sense-voice.onnx 0→239233841, /silero_vad.onnx →239877695, /tokens.txt →240193589]
```

其中 `[0, 239233841)` 的 sha256 与 `model.int8.onnx` **完全一致**，末段与 `tokens.txt` 一致；
中间的 `/silero_vad.onnx`（643KB）是个我们从不加载的更小导出。也就是整个包都是白带的。

麻烦在于 glue 把它当**硬运行依赖**：`addRunDependency("datafile_...")` 之后要靠
`processPackageData` 解包才会 `removeRunDependency`。文件缺失又没替代的话，运行时**不会报错**，
而是永久卡在未就绪 —— 最难查的那种症状。所以不能简单地删文件了事。

解法用 emscripten 自己的钩子：glue 会先问 `Module.getPreloadedPackage(name, size)`，
返回真值就完全不发请求。`offline-worker.js` 在 `importScripts` 之前把它设成返回空 `ArrayBuffer`
（`self.Module` 本来就先于 `importScripts` 建立，所以钩子一定生效）：

```js
self.Module = {
  getPreloadedPackage() {
    return new ArrayBuffer(0);
  },
  locateFile(path, scriptDirectory = '') { return scriptDirectory + path; },
  ...
};
```

依赖随即满足（空缓冲让每个条目都变成 0 字节占位文件，没有任何代码读它们），229MB
一个字节都不上网、也不进安装包。**代价为零的地方在于不用改上游 glue**：
`public/engines/sensevoice/` 里除 `offline-worker.js` 与 `audio-input-worklet.js` 外
都与官方发行包保持一致，升级时直接替换即可。

`src/ai/stt/senseVoiceAssets.test.ts` 锁住这两件事：运行时目录里既不出现模型/词表，
也不出现数据包，且 worker 保留了这个钩子（把上游文件换回来就会红）。


## 站点切换

三个站点在 `modelRepository.ts` 的 `MODEL_SITES` 里注册：`modelscope`（默认）→ `hf-mirror` → `huggingface`。

- **偏好**：`ProvisioningState.modelSites` 存一个**有序、去重、且必定覆盖全部站点**的数组
  （`normalizeModelSiteOrder`）。队首是用户在面板里选的那个，其余是自动回退链。
- **自动回退**：`POST /api/provisioning/download` 逐个站点尝试，失败的站点发 `site-failed` 事件后继续下一个；
  全部失败才发 `resource-error`，错误信息里带上每个站点的原因。
- **手动换源**：下载失败后面板出现「换源重试」——把当前队首降级到末尾并重新下载。
  之后点「完成」会把新顺序持久化，下次启动优先用实际成功的站点。

| 站点 | 列文件 | 取文件 | 默认分支 |
| --- | --- | --- | --- |
| modelscope | `/api/v1/models/{repo}/repo/files?Revision=&Recursive=True` | `/api/v1/models/{repo}/repo?Revision=&FilePath=` | `master` |
| hf-mirror / huggingface | `/api/models/{repo}/tree/{rev}?recursive=true` | `/{repo}/resolve/{rev}/{path}` | `main` |

## 下载落点：用户选定的目录

模型是体积主体，所以**不写进用户数据目录**（`%APPDATA%`）。`ProvisioningState.downloadRoot` 存一个绝对路径：

- 留空 → `<应用目录>/models`（`DEFAULT_DOWNLOAD_DIRECTORY`，便携版就在 exe 旁边，一定可写）；
- 用户填了 → 就用它。开始下载前 `downloadRootProblem()` 会 `mkdir -p` 并写一个探针文件，
  失败时把原因直接回给用户（「权限不足」「磁盘或路径不存在」「磁盘空间不足」）。
  **没有这个探测**，装在 `Program Files` 这类只读位置会表现为「所有下载站点都失败」，让人去查网络。

`downloadRoot` 在**第一个字节下载之前**就落盘：模型绝不能落在重启后资产路由不会去找的地方。

清单里的 `relative` 相对下载根目录：STT 是 `sherpa-asr`，嵌入模型是 `Qwen3-Embedding-0.6B`。

### 共享模型根：让同一台机器上的所有构建互认

下载根目录写在状态文件里，而状态文件按构建隔离（见上文门禁一节的引用）。所以每次
`writeProvisioningState()` 都同时把根目录发布到 `%LOCALAPPDATA%\Shiro\model-roots.json`
（`sharedModelRoots.ts`，**唯一入口**，调用方不可能忘）。服务端每次启动还会用已有状态发布一次，
覆盖「状态文件早于这个文件存在」的老机器。

这是一份**提示，不是权威**：

- 写：仍然只写 `ProvisioningState.downloadRoot` 指向的目录；
- 读：这些根排在所选目录和 `mirrors` **之后**被搜索（`resourceRoots()`），和 mirror 同性质；
- 多份：保留最近 4 个仍然存在的根（开发版 `E:\airi\models` 与安装版默认目录可以并存），
  目录已消失的条目读取时直接过滤掉；
- 失败不致命：写不进去只丢提示，`console.warn` 一句，绝不因此让请求失败。

它同时解决三件事：门禁能看见「模型在别的构建的目录里」（于是不再弹初始化）、STT worker 能通过
资产路由读到那个目录里的模型、记忆服务能被指向那份 1.2GB 的嵌入模型。

### 「选择目录」：原生选择器，而不是「打开目录」

面板上的按钮把路径写进输入框，走的是桌面壳的原生目录选择器
（`src/desktop/tauri/directoryPicker.ts`，底层 `@tauri-apps/plugin-dialog`）。四件事都要对上，
少一件就只剩手填：

- `src-tauri/Cargo.toml` 里 `tauri-plugin-dialog`，`main.rs` 里 `.plugin(tauri_plugin_dialog::init())`；
- `capabilities/default.json` 加 `dialog:allow-open` —— 该 capability 的窗口清单必须含 `setup`；
- 浏览器里没有原生对话框 → `pickDirectory()` 回 `unavailable`，面板提示手填；
- 选择器**不落盘**，只改输入框的值；持久化仍然只在开始下载时发生（见上）。
- 输入框变化会**防抖重查**报告（`GET /api/provisioning/resources?downloadRoot=<路径>`，只是预览、
  不落盘），所以指向一个已经有模型的目录时当场显示「已在 X 可用」/「已就绪」，而不是让人按下一个
  写着 1.4GB 的按钮才发现文件一直都在。

⚠️ 起始位置（`defaultPath`）只是一个**提示**。首次运行时它指向的 `<应用目录>/models` 还不存在，
而 Windows 在这种情况下会**拒绝打开**对话框 —— 所以失败会丢掉提示再问一次，而不是把用户堵在
一个他无法处理的错误上。`pickDirectory()` 因此返回一个判定（`picked` / `cancelled` /
`unavailable` / `failed`），让调用方自己决定要不要说话：取消不该弹提示。

### `mirrors`：不写、只读的备用位置

`ResourceManifestEntry.mirrors` 声明下载根目录**之后**按顺序查找的只读目录：

| 资源 | mirror | 为什么需要 |
| --- | --- | --- |
| `sherpa-asr-model` | `bundle` → `public/engines/sensevoice` | 运行时目录。Silero VAD 来自 sherpa-onnx 发行包、任何模型仓库都不提供，是这条 mirror 唯一还能满足的文件；模型本体**不在这里** |
| `memory-embedding-model` | `data` → `.local/models/Qwen3-Embedding-0.6B` | 下载根目录可配置之前，模型就放在这里；保留它，老机器不必重下 1.2GB |

mirror **不影响就绪判定**：就绪只看下载根目录里的完成标记，所以面板仍然会提示把模型放到你选的目录里。
共享模型根（上一节）排在这些 mirror 之后，性质相同：只读、只搜索。

### `requiredFiles`：给没有完成标记的副本一个公道

`ResourceManifestEntry.requiredFiles` 列出「运行时要读的文件」，用于回答「这份拷贝到底能不能用」：

| 资源 | requiredFiles | 依据 |
| --- | --- | --- |
| `sherpa-asr-model` | `model.int8.onnx`、`tokens.txt` | 正好是 `include` 允许清单：仓库那 7 个文件里只有这两个会被下载 |
| `memory-embedding-model` | `model.safetensors`、`config.json`、`tokenizer.json` | 权重 + 加载器要读的配置与词表（fast tokenizer 用 `tokenizer.json` 就够） |

完成标记是强信号（整仓库拉完才写），但**手工放进来的、或早于标记机制的副本没有它**。没有这个字段，
那样的副本在门禁眼里就是「缺资源」，用户会被要求为一个已经在硬盘上的模型再下一次 1.4GB。
判定是逐文件的，所以只下了一半的目录仍然算缺失。

> ⚠️ **`bundle` mirror 的文件必须同时列进 `src-tauri/tauri.conf.json` 的 `bundle.resources`。**
> 打包版的 `SHIRO_PROJECT_ROOT` 是 `resource_dir()`（安装目录），而安装目录里**没有** `public/`
> —— 前端 dist 是编译进 `Shiro.exe` 的，不是资源文件。所以 `public/engines/sensevoice` 这条 mirror
> 只有在 resources 里显式投放了对应文件时才存在（目前是 `silero_vad_v5.onnx` /
> `silero_vad_legacy.onnx` 两个，约 4MB）。漏了这条，dev 一切正常、
> 安装版 `/api/provisioning/assets/...` 直接 404 —— 就是仓库里反复出现的「只在安装版断」的坑。
>
> 兜底：worker 在页面给的 URL 失败时会退回 worker 自己目录下的同名文件（`fetchAssetWithFallback`）。
> 对两个 VAD 这条兜底真的有效——它们就在 worker 隔壁；对模型与词表则没有兜底可言（安装包里没有副本），
> 所以失败时错误信息会列出**每一个**试过的位置，并指向初始化面板。

## 就绪判定

面板的就绪**只看完成标记** `<下载根目录>/<relative>/.shiro-provisioning.json`，不看目录是否存在 ——
中途断掉的下载不能装成「已安装」。标记里记录 `site` / `repo` / `revision` / `files[]` / `bytes` / `completedAt`。

「能不能用」是另一个问题，由 `resourcePresence.ts` 给出 `ready` / `usable` / `absent` 三态（见
「首跑门禁」一节）：`usable` 让门禁不再弹初始化、让面板写明文件在哪，但**不会**把资源判成 `ready`
—— 面板照旧提供「放到我选的目录」这个选项，这是 mirror 一贯的语义。

下载是**可续跑**的：每个文件写 `<目标>.download` 再 rename，最终路径上不会出现半个文件；
重跑时按「已存在且大小与站点声明一致」跳过。代价是首次拉取到一半的仓库会留在原地（不删），
需要重来时删掉目录即可。

## 模型怎么被读回去

下载的模型在用户目录里，webview 没有它的 URL：打包版页面由 Tauri 的 asset 协议从安装目录提供，
**不属于安装包的文件在浏览器侧根本不可达**。所以唯一的路是后端：

```
GET /api/provisioning/assets/<resourceId>/<相对路径>
```

`resolveResourceAsset()` 按 `resourceRoots()` 的顺序（下载根目录 → mirrors）找第一个存在的文件并流式返回。
路径安全用**白名单**而不是 `..` 过滤：逐段拒绝空段、`.`、`..` 和反斜杠，所以 URL 编码的
`%2e%2e%2f`（Node 交过来仍是编码态）也过不去。

调用方是 sherpa-onnx worker：`sherpaSpeechConfig.createSenseVoiceAssetUrls()` 把四个文件名
（`model.int8.onnx` / `tokens.txt` / `silero_vad_v5.onnx` / `silero_vad_legacy.onnx`）拼成绝对 URL，
在 `init` 消息里交给 `offline-worker.js` 挂进 WASM 文件系统。**必须在 `ensureApiBase()` 之后构造**，
否则打包版会得到相对 URL 而打到 asset 协议上；worker 拿到 404 会给出「请先在初始化面板下载
『语音识别模型 · SenseVoice』」这种可执行的提示，而不是三步之后的 `recognizer could not be created`。

记忆侧走另一条路：`memoryServiceApi.ts` 用同一个 `resourceRoots()` 解析出目录并通过
`SHIRO_EMBEDDING_MODEL` 传给 Python。**不设这个变量**，`shiro_memory.py` 会回退到数据目录相对路径，
再回退到 HuggingFace 重下 1.2GB —— 静默、且让用户的目录选择形同虚设。

## 扩展：新增一个可下载模型

在 `resourceManifest.ts` 加一条：

```ts
{
  id: 'memory-rerank-model',
  label: '重排模型 · bge-reranker',
  feature: 'memory',
  relative: 'bge-reranker-base',      // 相对下载根目录
  sizeBytes: 400_000_000,             // 估算值，仅用于下载前提示；真实总量从站点列表得出
  description: '……',
  repo: { repo: 'BAAI/bge-reranker-base', include: ['model.onnx', 'tokenizer.json'] }
}
```

面板、路由、站点切换、进度显示都会自动接上，**不需要改前端**。若新功能需要自己的图标与标题，
在 `featureCatalog.ts` 的 `FEATURE_PRESENTATION` 里补一条。

**新增站点**只需往 `MODEL_SITES` 加一个描述符，并在 `provisioningTypes.ts` 的
`ModelSiteId` / `MODEL_SITE_OPTIONS` / `DEFAULT_MODEL_SITE_ORDER` 里登记。

## API

| 路由 | 方法 | 说明 |
| --- | --- | --- |
| `/api/provisioning/state` | GET / POST | 读 / 写 `<数据目录>/provisioning-state.json`（POST 会重新归一化） |
| `/api/provisioning/resources` | GET | `{ preparedResources, modelSites, downloadRoot, resolvedDownloadRoot, defaultDownloadRoot, resources[] }` |
| `/api/provisioning/download` | POST | `{ resourceIds, modelSites?, downloadRoot? }`，SSE 流式回进度 |
| `/api/provisioning/assets/<id>/<path>` | GET / HEAD | 从下载根目录（再 mirrors）读取资源文件 |

SSE 事件：`resource-start` / `site-attempt` / `site-listed` / `site-failed` / `file-start` / `progress` /
`resource-done` / `resource-skipped` / `resource-error` / `complete`。

## 验收

- 单测：`npx vitest run src/app/network/server/{modelRepository,resourceDownloader,provisioningAssets,provisioningStore}.test.ts`
  覆盖列文件、`include` 过滤（含「894 MiB 变体一个字节都不请求」）、嵌套目录落盘、聚合进度、重复运行跳过、
  站点失败回退、非 JSON 响应、路径安全、根目录顺序、可写性探测。
- 路由验证：`npx vite preview --config vite.preview.config.ts`（在进程内挂 `createApiModules()`，用的是当前源码）
  后 `curl /api/provisioning/resources` 与 `curl -I /api/provisioning/assets/sherpa-asr-model/model.int8.onnx`。
- 端到端脚本：`.local/triage/e2e-stt.sh` —— 真的从 ModelScope 拉一次语音识别模型到自定义目录，
  再确认资产路由返回的是**下载的那份**而不是随包那份。
- 打包版端到端需 `npm run build:fast` + `npm run verify:desktop`：Rust 门禁与 sidecar 都是冷路径
  （改 `memoryServiceApi.ts` 的 env 之后 sidecar 必须重打，见 `npm run server:package`）。

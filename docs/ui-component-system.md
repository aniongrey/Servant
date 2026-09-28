# UI 组件规范

新页面优先从 `src/ui/design-system` 导入 Mantine 组件；图标继续用 `lucide-react`，页面布局和品牌视觉用现有 CSS 与主题变量完成。避免新页面再造 Button、输入框、弹窗等基础控件。

全应用由 `ServantDesignSystem` 提供主题：夜金使用暗色外观，月白和樱梦使用亮色外观；主题色来自 `uiPreferences`。Mantine 组件通过 npm 依赖升级，升级时检查官方 changelog 并运行 `npm run typecheck`、`npm run build`。

`src/ui/shared/ServantControls` 暂作旧页面兼容层。改旧页面时按页面逐步迁移，不要一次性替换其控件样式。

## 字体

全站正文使用**得意黑（Smiley Sans）**，缺字与字重回退到**思源黑体（Source Han Sans SC）**。
字体只由两处决定，改字体时两处都要动：

- `src/ui/fonts.css` —— 唯一的 `@font-face` 定义处，同时声明三个令牌：
  `--font-sans`（正文）、`--font-mono`（代码 / 路径 / 数值）、`--font-serif`（装饰标题）。
  字体文件放在 `public/fonts/`，不加哈希：二进制文件每次改字重都哈希化会产生冗余副本，
  而 `build-fast.mjs` 的增量同步又需要文件名稳定。
- `src/ui/design-system/ServantDesignSystem.tsx` 的 `SERVANT_FONT_SANS` —— Mantine 主题的
  `fontFamily` 会被写成**内联样式**，拿不到 CSS 变量，所以这条栈只能重复一份字面量。

### 得意黑的两条硬约束

**它只有一个字重。** 字体 OS/2 的 `usWeightClass` 就是 400、`fsSelection` 是 Regular，
斜是画出来的字形，不是 `font-style: italic` 的合成。所以：

- 全站 `font-weight` 的 300 / 500 / 600 在它身上**没有任何视觉差异**（已实测 400 与 500
  逐像素相同）。只有 `700` 会掉到回退栈的思源黑体 Bold，于是**粗体是直立的思源、
  周围是斜的得意黑**——风格不统一，这是当前刻意的取舍。
- 想让层级重新成立，只有两条路：给得意黑配一个同族的标题字体，或放弃加粗、改用
  `font-size` + 颜色表达层级。

**它是窄斜体。** 同字号下比常规黑体窄约 15–20%，密集表单里更省地方，但大段正文的
可读性会下降。这是风格化的代价，不是 bug。

字符覆盖：CJK 基本区约 8057 字（占该区 38%），但**本项目实际界面文案的缺字率只有
0.04%**（12531 次汉字出现中仅 3 个字缺：薬、親、頭，都是日文）。缺字由回退栈里的
思源黑体逐字补上，不会漏成豆腐块。得意黑官方提供 woff2（1.3 MB），优先用它；
思源黑体是 iconfont 的 otf 包（Light / Regular / Medium / Bold，约 66 MB），
不做子集化是因为需要完整字符表，漏字风险大于省下的体积。

**任何 CSS 都不要写字体栈字面量**，一律用 `font-family: var(--font-sans)`。这条约束不是洁癖：
升级前全项目散落着 20 多种写法（`Inter, ui-sans-serif…`、`'Segoe UI Variable', 'Microsoft YaHei UI'…`、
`-apple-system, BlinkMacSystemFont…`），任何一次换字体都必然漏掉几处，表现成"大部分页面变了、
某个测试页没变"。

新增页面入口（`*-main.tsx`）时，**必须 import `../fonts.css`** —— 字体令牌不会自动继承。
用 `vite build` 后检查产物 HTML 里有没有 `fonts-*.css` 即可确认：

```bash
grep -o 'href="[^"]*fonts-[^"]*\.css"' dist/pages/<页面>.html
```

打包：五个字体文件已声明在 `src-tauri/tauri.conf.json` 的 `bundle.resources` 里，
`build-fast.mjs` 与安装包都会把它们放到 `public/fonts/`；漏声明会在运行时静默回退到雅黑。

验证字体是否**真的加载**（而不是静默回退）必须断言 `document.fonts.check(...)` 或各
`@font-face` 的 `status === 'loaded'`；只看 `getComputedStyle().fontFamily` 是假阳性，
字体没加载时它照样返回整条字体栈。

## 字号阶梯（十级）

`src/ui/fonts.css` 的 `:root` 里定义了十级令牌，**全站只允许用令牌**，不许写裸字号。
阶梯的取值不是拍脑袋定的：它是把改造前散落全项目的约 40 种字号（12px 64 次、
11px 60 次、10px 33 次、`0.58rem` 17 次……）按 14px 基准折算后聚类得到的。

| 令牌              | px  | 用途                                         | 对应改造前的典型值      |
| ----------------- | --- | -------------------------------------------- | ----------------------- |
| `--text-display`  | 34  | 全屏仪式感画面（Magic Circle、启动页主标题） | `2rem` / `34px`         |
| `--text-hero`     | 21  | 页面主标题、区块大标题                       | `22px` / `1.48rem`      |
| `--text-title`    | 17  | 卡片标题、分区标题                           | `18px` / `1.15rem`      |
| `--text-subtitle` | 15  | Galgame 台词、聊天正文、列表主文本           | `15px` / `1.05rem`      |
| `--text-body`     | 14  | **默认正文，同时是 rem 基准（1rem = 14px）** | `14px` / `1rem`         |
| `--text-label`    | 13  | 表单标签、按钮文字、侧栏导航项               | `13px` / `0.92rem`      |
| `--text-caption`  | 12  | 说明文字、Galgame 状态标签                   | `12px` / `0.86rem`      |
| `--text-fine`     | 11  | 密集表格正文、设置项描述                     | `11px` / `0.78–0.82rem` |
| `--text-micro`    | 10  | 元信息：时间戳、版本号、角标                 | `10px` / `0.70–0.75rem` |
| `--text-nano`     | 9   | 密集日志、状态灯文字 —— **下限**             | `9px` / `0.64–0.68rem`  |

### 阶梯外：装饰性尺寸

**小于 9px 或大于 34px 的尺寸允许保留裸 px**，但必须满足两个条件：

1. 就地写注释说明它是刻意的装饰性尺寸（而不是漏改的）；
2. 只出现在展示性/调试性位置 —— 测试页的计数器、日志行、头像占位数字。

当前保留的裸 px 清单（改造后仅剩这些）：

- `user-interface.css` / `styles.css` / `character-profiles.css`：`6px`–`9px` 密集角标
- `styles.css`：`clamp(19px, 2.4vw, 28px)`、`clamp(18px, 2vw, 24px)` 流式 `h1`
- `interaction-test.css` / `realtime-test.css` / `magic-circle-demo.css` /
  `llm-latency-test.css`：`clamp(22px…)`–`clamp(32px…)` 测试页大标题
- `character-profiles.css:48px` 头像数字、`interaction-test.css:60px` 大计数器

**流式 `clamp()` 的 min 边界可以写裸 px** —— 它是随视口伸缩的区间端点，
不是一个固定层级，塞进阶梯反而会误导（改一处 `clamp` 的 min 是为了适配某个断点，
不是为了调整层级）。

### 行高

行高**不做十级阶梯**：全站只有 46 处 `line-height` 声明，而 `html, body` 上的
`--leading-body` 已经兜住绝大多数文本，剩下的是刻意微调。只保留三档有明确语义的：

| 令牌              | 值   | 用途                          |
| ----------------- | ---- | ----------------------------- |
| `--leading-tight` | 1.25 | 大标题、名字牌                |
| `--leading-body`  | 1.65 | 正文默认（挂在 `html, body`） |
| `--leading-loose` | 1.8  | 大段可读文本、Galgame 台词    |

## 字重只有两档

得意黑单字重，所以全站**只有两档字重是真实生效的**：

- `--weight-normal`（400）→ 走得意黑
- `--weight-strong`（700）→ 掉到回退栈的思源 Bold

改造前全项目有 58 处 `500` / `600` / `650` / `750` / `800` / `900`，其中
**500–600 全部渲染成 400** —— 作者以为写了"半粗"，实际毫无效果。已全部归一化：
≤600 → `--weight-normal`，≥700 → `--weight-strong`。**新代码不要再写中间档。**

## 倾斜

得意黑的斜是**字形自带**的，不是 `font-style: italic` 的合成。

- **全站一律不写 `font-style: italic`** —— 字形已经斜了，再叠一次会变成双重倾斜的糊字。
- 唯一需要正体的地方是**代码与路径**，用 `--font-mono` 自然解决（等宽字体不含 CJK，
  中文逐字回退到思源黑体，仍保持直立）。

## rem 基准只有一个

`:root` 显式声明 `font-size: var(--text-body)`（14px）。**不写的话 rem 跟着浏览器默认
16px 走**，而历史代码是按 14px 直觉写的 rem 值，会整体偏大 14%。

### Mantine 会把基准顶掉，必须用 `!important` 压回去

Mantine 挂载时给 `<html>` 写**内联样式** `font-size: 16px`。内联样式优先于任何选择器，
所以 `:root` 里的 14px 会被它顶掉 —— 一旦顶掉，任何写在 Mantine 子树里的裸 rem
就按 16px 解析。两处配合解决：

1. `fonts.css` 里 `html { font-size: var(--text-body) !important; }` —— 压回 14px；
2. `ServantDesignSystem.tsx` 里三个主题都加 `scale: 0.875`（= 14/16）——
   让 Mantine 自己的 `calc(Xrem * var(--mantine-scale))` 也按 14px 算。

**改任一处都要同时改另一处**，否则 Mantine 组件和自有组件会差 14%。
验证方法：在 Mantine 子树里插一个 `font-size: 1rem` 的探针，`getComputedStyle` 应当返回 `14px`。

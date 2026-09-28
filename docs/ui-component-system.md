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
11px 60 次、10px 33 次、`0.58rem` 17 次……）按 16px 基准折算后聚类得到的。

**基准 16px**：早期版本曾把正文钉在 14px，但用户反馈「看不清」——Windows 系统 UI 的
正常正文就是 16px（`Segoe UI` 9pt）。整条阶梯已统一 +2px，正文回到 16px，rem 基准
也随之等于浏览器默认的 16px。

| 令牌              | px  | 用途                                         | 对应改造前的典型值      |
| ----------------- | --- | -------------------------------------------- | ----------------------- |
| `--text-display`  | 36  | 全屏仪式感画面（Magic Circle、启动页主标题） | `2rem` / `34px`         |
| `--text-hero`     | 24  | 页面主标题、区块大标题                       | `22px` / `1.48rem`      |
| `--text-title`    | 19  | 卡片标题、分区标题                           | `18px` / `1.15rem`      |
| `--text-subtitle` | 17  | Galgame 台词、聊天正文、列表主文本           | `15px` / `1.05rem`      |
| `--text-body`     | 16  | **默认正文，同时是 rem 基准（1rem = 16px）** | `14px` / `1rem`         |
| `--text-label`    | 15  | 表单标签、按钮文字、侧栏导航项               | `13px` / `0.92rem`      |
| `--text-caption`  | 14  | 说明文字、Galgame 状态标签                   | `12px` / `0.86rem`      |
| `--text-fine`     | 13  | 密集表格正文、设置项描述                     | `11px` / `0.78–0.82rem` |
| `--text-micro`    | 12  | 元信息：时间戳、版本号、角标                 | `10px` / `0.70–0.75rem` |
| `--text-nano`     | 11  | 密集日志、状态灯文字 —— **下限**             | `9px` / `0.64–0.68rem`  |

### 语义角色 → 令牌的映射（设置页准绳）

阶梯是"有哪些尺码"，下面是"哪种内容穿哪件"。这张表来自用户给的规格，
**设置类页面（`user-interface.css`）按它对齐**，其它页面可作参照：

| 语义角色                            | 字号                      | 字重                     |
| ----------------------------------- | ------------------------- | ------------------------ |
| 页面主标题 `page-title`             | `--text-hero` 24          | `--weight-strong` 700    |
| 页面眉标 `page-eyebrow`（英文）     | `--text-nano` 11          | `--weight-medium` 600    |
| 模块/卡片标题 `card-title`          | `--text-body` 16          | `--weight-strong` 700    |
| 卡片小标 `card-kicker`（英文）      | 10px（装饰）              | `--weight-medium` 600    |
| 左侧导航项 `nav-item`               | `--text-label` 15         | `--weight-medium` 600    |
| 导航英文副标 `nav-subtitle`         | `--text-nano` 11          | `--weight-medium` 600    |
| 正文 / 设置项名称                   | `--text-caption` 14       | `--weight-normal` 400    |
| 说明文字（设置项描述）              | `--text-micro` 12         | `--weight-normal` 400    |
| 数值输出（`1.3` / `0.75`）          | `--text-fine` 13          | `--weight-medium` 600    |
| 输入框内容                          | `--text-caption` 14       | `--weight-normal` 400    |
| 字段标签 `field > span`             | `--text-micro` 12         | `--weight-medium` 600    |

**两条硬规则**：

1. **说明文字不得低于 12px（`--text-micro`）。** 用户原话：「**不要低于 12px**」。
   核心交互说明可放宽到 `--text-fine` 13px。
2. **10px 以下只允许用于装饰性英文，不允许承载功能信息。** 这是
   `--text-nano`(11) 之下唯一被允许的裸值（`card-kicker` 的 10px），
   且只能放 `GENERAL` / `APPEARANCE` 这类**不读也不影响操作**的英文小标。

**为什么"看起来小"往往不是阶梯值太小**：用户反馈设置页"缩"的那次，
目标值 24/16/15/14/12/11/13 与阶梯**几乎完全一致**——真因是 UI **没用对令牌**
（导航项被压在 `--text-fine` 13px 而非 `--text-label` 15px、说明文字被压在
`--text-nano` 11px 而非 `--text-micro` 12px）。**先核对映射，再动阶梯。**

### 疏密：字号 ↑ 必须连带行高与留白 ↑

只把字号调大、行高与内边距不动，会立刻显得"挤"。规格要求同步调整：

- 行高：说明文字统一 `line-height: 1.6`（不要 1.45）
- 导航项高度：**70px**（原 54px）
- 设置项行高：**70px**（`min-height`，原 66px），内边距 `12px 14px`
- 卡片内实心按钮/控件高度：**38px**（原 36px）

### 阶梯外：装饰性尺寸

**小于 11px 或大于 36px 的尺寸允许保留裸 px**，但必须满足两个条件：

1. 就地写注释说明它是刻意的装饰性尺寸（而不是漏改的）；
2. 只出现在展示性/调试性位置 —— 测试页的计数器、日志行、头像占位数字。

当前保留的裸 px 清单（阶梯整条 +2px 后，全项目只剩这 3 处真正的装饰性尺寸）：

- `user-interface.css`：`6px` —— 一个纯装饰的小圆点，不含可读文字
- `character-profiles.css:48px` —— 头像占位数字
- `interaction-test.css:60px` —— 测试页大计数器

- `styles.css`：`clamp(19px, 2.4vw, 28px)`、`clamp(18px, 2vw, 24px)` 流式 `h1`
- `interaction-test.css` / `realtime-test.css` / `magic-circle-demo.css` /
  `llm-latency-test.css`：`clamp(22px…)`–`clamp(32px…)` 测试页大标题

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

### 扫字号时别只扫 `font-size:`

**`font:` 简写也带字号**（`font: 500 8px var(--font-serif)`）。只 grep `font-size`
会漏掉整整一类——`user-interface.css` 就曾藏着 29 处简写形式的小字号，且它们
大多没有空格（`font:8px var(--font-mono)`），连 `font-size: [0-9]+px` 这种宽松正则
也匹配不到。复核时用：

```bash
grep -rnE "font-size: *[0-9]+px|font: *[^;]*[0-9]+px" src/ --include=*.css
```

改简写里的字号时**要把整个简写重写一遍**（`font: 500 var(--text-nano) var(--font-serif)`），
因为 `font` 简写会重置 `font-weight` / `font-family` / `line-height` —— 只把数字换成
令牌、其余照抄是最省事的写法。

另外 `font: 8px/1.6 var(--font-mono)` 这种**带行高的**，换成令牌时要保留斜杠
（`font: var(--text-nano)/1.6 var(--font-mono)`），否则行高会被重置。

## 字重只有三档，且 `--weight-strong` 靠 `@font-face` 的声明范围才能生效

得意黑单字形，回退栈的思源黑体负责粗体，所以全站**只有三档字重有明确语义**：

- `--weight-normal`（400）→ 得意黑（唯一字形）
- `--weight-medium`（600）→ **得意黑下与 400 逐像素相同**，是语义占位
  （导航项、英文小标），将来换字体时能区分开
- `--weight-strong`（700）→ 掉到回退栈的**思源 Bold**（真粗体）

改造前全项目有 58 处 `500` / `600` / `650` / `750` / `800` / `900`，其中
**500–600 全部渲染成 400** —— 作者以为写了"半粗"，实际毫无效果。已全部归一化：
≤600 → `--weight-medium`，≥700 → `--weight-strong`。**新代码不要再写 500 或裸数字。**

### ⚠️ 让 700 真生效的前提：`@font-face` 必须写 `font-weight: 400 600`

这是最容易静默失效的一处。得意黑的 `@font-face` 原来声明的是 `font-weight: 100 900`，
浏览器于是认为**这个 family 有全部字重**，`700` 也被它接走 ——
回退栈里的思源 Bold **永远轮不到**，全站中文因此**完全没有粗细对比**。

修法是**收窄声明范围**：

```css
@font-face {
  font-family: 'Smiley Sans';
  src: url('/fonts/SmileySans-Oblique.otf.woff2') format('woff2');
  font-weight: 400 600; /* 不要写 100 900 */
}
```

- `400–600` → 得意黑（正文观感）
- `≥700` → 超出范围，落到思源 Bold（真粗体，中文可见）

代价是粗体直立、周围斜体，风格不统一 —— 但"标题有分量"比"风格纯净"重要。
**别把它改回 `100 900`。**

### 怎么验证 CJK 字重：别看宽度，看 PNG 字节

`getComputedStyle().fontWeight` 只返回声明值，`getBoundingClientRect().width`
对 CJK **无效** —— 思源 Regular 与 Bold 的 advance width 完全相同（实测都是 160px）。

唯一可靠的判据是**同尺寸元素的截图 PNG 字节数**：墨迹越多、压缩后越大。

| 字重 | PNG 字节（40px「系统设置」） |
| ---- | ---------------------------- |
| 400  | 12061                        |
| 600  | 12048                        |
| 700  | **13129** ← 明显更大 = 真粗体 |

若 400 与 700 的字节几乎相同，说明粗体没生效，回去检查 `@font-face` 的声明范围。

## 倾斜

得意黑的斜是**字形自带**的，不是 `font-style: italic` 的合成。

- **全站一律不写 `font-style: italic`** —— 字形已经斜了，再叠一次会变成双重倾斜的糊字。
- 唯一需要正体的地方是**代码与路径**，用 `--font-mono` 自然解决（等宽字体不含 CJK，
  中文逐字回退到思源黑体，仍保持直立）。

## rem 基准只有一个

`:root` 显式声明 `font-size: var(--text-body)`（现为 16px）。写成令牌而不是让 rem 跟着
浏览器默认走，是为了「调基准只改一处」。基准现在恰好等于浏览器默认的 16px，
所以 `1rem = 16px`，与大多数 Web 代码的直觉一致。

### Mantine 会把基准顶掉，必须用 `!important` 压回去

Mantine 挂载时给 `<html>` 写**内联样式** `font-size: 16px`。内联样式优先于任何选择器，
所以 `:root` 里的值会被它顶掉。两处配合解决：

1. `fonts.css` 里 `html { font-size: var(--text-body) !important; }` —— 压回令牌值；
2. `ServantDesignSystem.tsx` 里 `SERVANT_SCALE` —— 让 Mantine 自己的
   `calc(Xrem * var(--mantine-scale))` 也对齐。

**基准 16px 时 `SERVANT_SCALE = 1`**（Mantine 默认根就是 16px，不需要缩放）。
历史：基准曾是 14px，那时需要 `0.875`（= 14/16）对冲；阶梯 +2px 后必须改回 1，
否则 Mantine 组件会比全站其他部分小 12.5%。

**改任一处都要同时改另一处**。验证方法：在 Mantine 子树里插一个 `font-size: 1rem` 的
探针，`getComputedStyle` 应当返回 `16px`。

## Galgame 名字牌：一行三元素，全是纯文字

`StageControls.tsx` 的台词头部是「名字 + 表情 + 动作」一行，三者**都是纯文字，
任何一个都不要做成实心块或胶囊**（`stage.css` 的 `.galgame-dialogue-name` /
`.galgame-emotion` / `.galgame-action`）。层级只靠**字号与颜色**：

| 元素 | 字号                    | 字重              | 颜色             |
| ---- | ----------------------- | ----------------- | ---------------- |
| 名字 | `--text-label` (15px)   | `--weight-strong` | 暖白 `#f4e9d6`   |
| 表情 | `--text-caption` (14px) | `--weight-normal` | 薄荷绿 `#7fd6b0` |
| 动作 | `--text-caption` (14px) | `--weight-normal` | 樱粉 `#e9a8c9`   |

表情与动作之间用一条 `1px #ffffff26` 竖线分隔（`padding-left: 11px`），避免被连读成一个词。

**为什么不做色块**：三个方块并排时，每个都是独立重心，互相抢注意力；而且
名字一旦有底色，视觉重心会全被那块颜色夺走，另外两个被衬成附属。平铺成文字后
三者同级，斜度也统一（见下）。

**为什么状态标签不用加粗区分**：得意黑只有一个字重，`700` 会掉到回退栈的思源 Bold
（直立的），混在斜体里反而更跳。所以两个状态都用 400，只靠颜色分。

### 一个容易误判的观感问题：小字号下"看起来直立"

得意黑是窄斜体，**斜度在小字号下几乎看不出来**。所以小的名字容易被误认为
"直立"、而大一号的台词显得很斜，进而误判成"名字被某个字体覆盖了"。
实测方法是量**渲染宽度**（同字号同文本，换字体会改 advance width）而不是看观感：

```js
const r = document.createRange();
r.selectNodeContents(el);
r.getBoundingClientRect().width; // 400/500/600/700 四档宽度相同 ⇒ 都是得意黑
```

真正的"覆盖"只会发生在：① 该字在得意黑里缺（回退思源，直立）；② 显式写了其他
`font-family`。全站 `font-family` 已收口到 `var(--font-sans)`，所以基本只剩前者。

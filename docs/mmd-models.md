# MMD 角色

Servant 使用 `@yohawing/three-mmd-loader@0.8.4` 加载 PMX / PMD，保留原有 VRM 加载。

## 使用

在「设置 → 角色 → 模型库」点击「导入模型文件夹」，选择存放 PMX / PMD 的文件夹（本机为
`E:\airi\VRM\blue-fish-mmd`）。模型需位于该文件夹的第一层，贴图可与模型同级或放在 `textures`
子目录；导入时会解析 PMX 内引用的相对路径，把用得到的贴图一并存入模型库，之后可像 VRM 一样
选择、重命名或删除，也可绑定到角色后应用到桌面。

「导入模型文件」仍只用于单文件 VRM；两条入口互不替代。

模型与贴图存放于浏览器 IndexedDB（`codex-list-character-assets`）：整个文件夹打包成一条记录，
因此模型库的计数、重命名、删除与桌面同步都按单文件那套逻辑走。桌面窗口与设置窗口读同一份存储，
不需要把模型上传到后端（后端的模型接口只接受 GLB）。

也可以继续把模型放进 `public/assets/character/<模型目录>/`，由构建期扫描后在库中出现带 `MMD`
后缀的条目；外置目录不必复制进仓库。

本机的外置资产目录不在 Git 内，不随源码提交；模型作者为水原镜，MMD 绑定为耶栗 Yaki，使用范围以
目录内原规约为准。

## 动作与表情

`src/character/mmd/MmdCharacter.ts` 将日文 MMD 人形骨骼映射为 three-vrm 的 normalized humanoid。
进入 Servant 前统一尺寸至约 1.5 m 并校准 A-pose → T-pose，原蒙皮绑定矩阵保持不变。
已有 VRMA、分部动作、微动作、视线和口型继续走现有控制器；腿部 D 骨跟随 FK 骨。
舞台支持滚轮缩放。个别动作的手臂与身体接触需要按此模型调整 Avatar Fit 参数。
在调试页单独循环测试某条 VRMA 时，先点 `Stop Actions` 暂停自动待机动作，再点 `Play`，避免自动调度覆盖测试。

表情定义在 `src/character/mmd/expression-map.json`，当前针对蓝色大肥鱼模型的 Morph：

| Servant / VRM | MMD Morph |
|---|---|
| neutral | 清除情绪，不改变默认脸 |
| happy / angry / sad / surprised | Fcl_ALL_Joy / Angry / Sorrow / Surprised |
| relaxed / fun | Fcl_ALL_Fun × 0.6 / × 1 |
| blink / blinkLeft / blinkRight | Fcl_EYE_Close / Close_L / Close_R |
| aa / ih / ou / ee / oh | Fcl_MTH_A / I / U / E / O |
| lookLeft / lookRight / lookUp / lookDown | EyeLeft / EyeRight / EyeUp / EyeDown |

情绪切换只清除情绪权重，保留眨眼、口型和视线。`natural` 别名及对话 mood 仍由 Servant 的
ExpressionController / moodPresentation 管理。其他 MMD 的 Morph 名和骨骼名可能不同，需相应修改映射；
缺少必须骨骼会明确报错，缺少表情 Morph 会记录诊断，不会用错索引。

## 当前边界

保留该模型眼部透明裁切修正和加载器的袖子材质处理。VRM 的 MToon 专用参数不控制 MMD 材质。
刚体 / 关节物理已接入（在模型空间步进，见 `MmdCharacter.stepPhysics`），头发与裙摆有动力学；
VMD 播放未接入，姿态由 VRMA 驱动。
MMD 更新时不运行加载器的 VMD 求值器，以免覆盖 VRMA 姿态和当前表情。

## 验证

`npx vitest run src/character/mmd/MmdCharacter.test.ts` 验证表情通道和骨架校准；本机有上述 PMX 时，
还会遍历动作目录中的全部 VRMA，验证真实模型姿态数值及重复采样。贴图显示另在浏览器验收。

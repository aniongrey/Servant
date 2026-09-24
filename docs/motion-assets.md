# 动作资产（VRMA）

`README.md` 的授权一节按这份表判断每个动作的条款，改动作目录时请一并更新。

## 目录契约

```
public/assets/motions/vrma/          # 唯一目录，扁平，59 个 .vrma
```

- **文件名就是动作 id**：小写连写拼音，取含义而非音译 —— `daiji` = 待机、`sikao` = 思考、
  `huishou` = 挥手、`dazhaohu` = 打招呼。改文件名等于改 id。
- **没有登记表。** `src/character/motion/assets/vrmaAssetFiles.ts` 里的
  `import.meta.glob('/public/assets/motions/vrma/*.vrma')` 是唯一清单；`/api/vrma-files`
  （`src/app/network/server/vrmaFilesApi.ts`）只按磁盘再过滤一遍，两者都只认这一层目录。
  新增动作 = 放文件 + 重建，不需要改任何注册代码。
- **改文件名要同步四处引用**：`assets/actions/action-configs.json`（局部动作）、
  `assets/actions/full-body-motion-config.json` 的 `emotion.*.vrma.file`（组合动作）、
  `assets/vrma-segments.json`（编辑器切片 key）、`assets/manifest.json`。都写 `vrma/<id>.vrma`。
  改完跑一遍全仓引用检查，别让任何一处指向不存在的文件。
- **整个目录不在版本库里**：`.gitignore` 的 `[Vv][Rr][Mm][Aa]/` 规则把 `vrma/` 排除了，
  所以 `git mv` 无效，搬文件要用文件系统操作，也不会有 `git log` 记录。

## 来源与授权

拍平之前按来源分目录（`VRMA/Kimodo/`、`VRMA/Rokoko/`…），目录结构本身就是授权线索。
现在结构不携带来源，**下表是唯一的出处记录**：

### Kimodo（5 个）

_来源：手写交互循环，随项目一起产生_

| 动作 id | 原文件（相对 `motions/`） |
| --- | --- |
| `beishou.vrma` | `Kimodo/kimodo_handback2.vrma` |
| `chayao.vrma` | `Kimodo/hands_on_hips.vrma` |
| `daiji.vrma` | `Kimodo/idle.vrma` |
| `jiudaiji.vrma` | `oldIdle.vrma` |
| `zhixiang.vrma` | `Kimodo/pointing.vrma` |

### Mixamao（22 个）

_来源：Mixamo 派生手势/情绪包_

| 动作 id | 原文件（相对 `motions/`） |
| --- | --- |
| `chenshiyaotou.vrma` | `Mixamao/GesturesPackBasic/thoughtful head shake.vrma` |
| `diantou.vrma` | `Mixamao/GesturesPackBasic/head nod yes.vrma` |
| `fannaoyaotou.vrma` | `Mixamao/GesturesPackBasic/annoyed head shake.vrma` |
| `haixiu.vrma` | `Mixamao/Bashful.vrma` |
| `houkongfan.vrma` | `Mixamao/Backflip.vrma` |
| `huanzhongxin.vrma` | `Mixamao/GesturesPackBasic/weight shift.vrma` |
| `huishou.vrma` | `Mixamao/Waving.vrma` |
| `jingya.vrma` | `Mixamao/Surprised.vrma` |
| `juezuiba.vrma` | `Mixamao/Pouting.vrma` |
| `kaixin.vrma` | `Mixamao/Happy.vrma` |
| `rentong.vrma` | `Mixamao/GesturesPackBasic/acknowledging.vrma` |
| `roujian.vrma` | `Mixamao/Shoulder Rubbing.vrma` |
| `shengqishoushi.vrma` | `Mixamao/GesturesPackBasic/angry gesture.vrma` |
| `shenzhan.vrma` | `Mixamao/Arm Stretching.vrma` |
| `shuohua.vrma` | `Mixamao/Talking.vrma` |
| `sikao.vrma` | `Mixamao/Thinking.vrma` |
| `songjian.vrma` | `Mixamao/Shrugging.vrma` |
| `tiaoxindaiji.vrma` | `Mixamao/Offensive Idle.vrma` |
| `tibaodaiji.vrma` | `Mixamao/Standing W_Briefcase Idle.vrma` |
| `xingfen.vrma` | `Mixamao/Excited.vrma` |
| `zhengchao.vrma` | `Mixamao/Standing Arguing.vrma` |
| `zouxiu04.vrma` | `Mixamao/Catwalk Sequence 04.vrma` |

### Rokoko（16 个）

_来源：Rokoko 免费 mocap 动作包_

| 动作 id | 原文件（相对 `motions/`） |
| --- | --- |
| `beijidao.vrma` | `Rokoko/Combat/KnockOut_Loser_mixamo.vrma` |
| `chijiandaiji.vrma` | `Rokoko/Combat/SwordIdleMedium_mixamo.vrma` |
| `daqianti.vrma` | `Rokoko/Combat/BigFrontKick_mixamo.vrma` |
| `feixing.vrma` | `Rokoko/Superhero/SuperHeroFlying_mixamo.vrma` |
| `fukanchengshi.vrma` | `Rokoko/Superhero/WatchOverCity_mixamo.vrma` |
| `jidaoshengli.vrma` | `Rokoko/Combat/KnockOut_Winner_mixamo.vrma` |
| `jiqiwu.vrma` | `Rokoko/Dancing/DoTheRobot_mixamo.vrma` |
| `mofaxiangzhi.vrma` | `Rokoko/Magic/MagicSnaps_mixamo.vrma` |
| `nengliangbaofa.vrma` | `Rokoko/Magic/GiantEnergyBlast_mixamo.vrma` |
| `paiduiwu.vrma` | `Rokoko/Dancing/NPC_DancingParty_mixamo.vrma` |
| `qingyaobaiwu.vrma` | `Rokoko/Dancing/GentleSwayingDancing_mixamo.vrma` |
| `qishen.vrma` | `Rokoko/IdlesMocapPack_noFACE/Rise_03_mixamo.vrma` |
| `quanji.vrma` | `Rokoko/Combat/Boxing_mixamo.vrma` |
| `shangbu.vrma` | `Rokoko/IdlesMocapPack_noFACE/StepForward_mixamo.vrma` |
| `zhandoudaiji.vrma` | `Rokoko/Combat/FightingIdle_mixamo.vrma` |
| `zhuanshen.vrma` | `Rokoko/IdlesMocapPack_noFACE/Turns_mixamo.vrma` |

### Sample（9 个）

_来源：VRoid 官方 Sample 包_

| 动作 id | 原文件（相对 `motions/`） |
| --- | --- |
| `fangsong.vrma` | `Sample/Relax.vrma` |
| `guzhang.vrma` | `Sample/Clapping.vrma` |
| `huangu.vrma` | `Sample/LookAround.vrma` |
| `kimodohuishou.vrma` | `Sample/kimodo_wave.vrma` |
| `kunjuan.vrma` | `Sample/Sleepy.vrma` |
| `lianhong.vrma` | `Sample/Blush.vrma` |
| `nanguo.vrma` | `Sample/Sad.vrma` |
| `shengqi.vrma` | `Sample/Angry.vrma` |
| `tiaoyue.vrma` | `Sample/Jump.vrma` |

### VRoid（7 个）

_来源：pixiv VRoid 动作包（`VRMA_0*`）_

| 动作 id | 原文件（相对 `motions/`） |
| --- | --- |
| `baipai.vrma` | `VRoid/VRMA_06_Model_pose.vrma` |
| `biye.vrma` | `VRoid/VRMA_03_Peace_sign.vrma` |
| `dazhaohu.vrma` | `VRoid/VRMA_02_Greeting.vrma` |
| `dunxia.vrma` | `VRoid/VRMA_07_Squat.vrma` |
| `sheji.vrma` | `VRoid/VRMA_04_Shoot.vrma` |
| `xuanzhuan.vrma` | `VRoid/VRMA_05_Spin.vrma` |
| `zhanshiquanshen.vrma` | `VRoid/VRMA_01_Show_full_body.vrma` |


> 已移除 `yanglisikao.vrma`：它是 `Sample/Thinking.vrma`，与 `sikao.vrma`
> （`Mixamao/Thinking.vrma`）语义重复，且没有任何配置引用它。

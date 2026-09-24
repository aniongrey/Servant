# 直播与角色事件

## 直播输入管线

```text
BarrageGrabAdapter
-> LiveEventNormalizer
-> BlacklistManager
-> LiveContentFilter
-> DuplicateAggregator
-> LivePriorityCalculator
-> LiveEventQueue
-> LiveController
-> LiveEventConsumer
```

实现位于 `src/integrations/barrage`。黑名单先于内容过滤，内容过滤先于聚合和优先级。等价弹幕保留一个队列位置并累计次数、用户和时间元数据。

优先级语义：

- HIGH 可以绕过普通 cooldown。
- NORMAL 遵守 cooldown。
- LOW 在当前版本只用于观察。
- 调度前必须清除 TTL 已过期事件。
- 语音占用通过 `LiveController.onSpeechStart()` / `onSpeechEnd()` 表达。

## 角色动作

业务层选择语义动作与表情：

```json
{
  "actions": ["hands_on_hips", "turn_head"],
  "expression": "angry"
}
```

`ActionRuntime` 根据动作目录和身体区域播放 VRMA；表情独立交给 `ExpressionController`。事件脚本位于 `src/event/events/scripts`，新剧情优先使用 `action` step。

身体区域为 Root、LowerBody、Torso、Head、LeftArm、RightArm、Face。持续动作按 Enter → Hold Loop → Exit 执行；one-shot 完成后恢复之前动作或区域 idle。

## 外部集成

- `src/integrations/poe2`：客户端日志、掉落检测和游戏事件反应。
- `src/integrations/music`：音乐能力预留边界。

外部适配器不得直接依赖 TTS、`CharacterStateManager` 或具体动作控制器，应通过规范化事件与消费接口解耦。

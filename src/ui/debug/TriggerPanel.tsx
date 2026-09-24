import { type AgentRuntime } from '../../ai/AgentRuntime';
import { type DebugPanelSectionId } from './debugConfig';
import {
  Sparkles,
  Home,
  Siren,
  HeartHandshake,
  MessageCircleHeart,
  UserX,
  Gift,
  FastForward,
  Moon,
  CalendarHeart
} from 'lucide-react';
import { DebugSection } from './DebugControls';

export function TriggerPanel({
  open,
  onToggle,
  engine
}: {
  open: boolean;
  onToggle: (section: DebugPanelSectionId, open: boolean) => void;
  engine: AgentRuntime;
}) {
  return (
    <DebugSection id="triggers" onToggle={onToggle} open={open} title="Triggers">
      <div className="buttonGrid">
        <button onClick={engine.actions.missedPromise}>
          <Siren size={17} />
          用户失约
        </button>
        <button onClick={engine.actions.comfort}>
          <HeartHandshake size={17} />
          哄一下
        </button>
        <button onClick={engine.actions.apology}>
          <MessageCircleHeart size={17} />
          道歉
        </button>
        <button onClick={engine.actions.praise}>
          <Sparkles size={17} />
          夸奖
        </button>
        <button onClick={engine.actions.shyCompliment}>
          <Sparkles size={17} />
          害羞
        </button>
        <button onClick={engine.actions.sadnessSpike}>
          <UserX size={17} />
          难过
        </button>
        <button onClick={engine.actions.happyGift}>
          <Gift size={17} />
          礼物
        </button>
        <button onClick={engine.actions.userReturn}>
          <Home size={17} />
          回家
        </button>
        <button onClick={engine.actions.workStart}>
          <FastForward size={17} />
          开工
        </button>
        <button onClick={engine.actions.goodnight}>
          <Moon size={17} />
          晚安
        </button>
        <button onClick={engine.actions.birthdayToday}>
          <CalendarHeart size={17} />
          生日
        </button>
        <button onClick={engine.actions.anniversaryToday}>
          <CalendarHeart size={17} />
          纪念日
        </button>
        <button onClick={engine.actions.ignore}>
          <UserX size={17} />
          忽略
        </button>
        <button onClick={engine.actions.tailPoke}>
          <Sparkles size={17} />
          点尾巴
        </button>
      </div>
    </DebugSection>
  );
}

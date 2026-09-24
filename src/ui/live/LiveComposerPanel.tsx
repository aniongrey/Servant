import { Send } from 'lucide-react';
import { Panel } from './LiveTestControls';
import type { LiveTestController } from './useLiveTestController';
import type { LiveEventType, LivePlatform } from '../../integrations/barrage/events/LiveEvent';

type Props = Pick<LiveTestController, 'composer' | 'setComposer' | 'handleComposerSubmit'>;

export function LiveComposerPanel({ composer, setComposer, handleComposerSubmit }: Props) {
  return (
    <Panel title="构造事件" icon={<Send size={17} />}>
      <form className="eventForm" onSubmit={handleComposerSubmit}>
        <div className="fieldPair">
          <label>
            平台
            <select
              value={composer.platform}
              onChange={(event) => setComposer({ ...composer, platform: event.target.value as LivePlatform })}
            >
              <option value="bilibili">Bilibili</option>
              <option value="douyin">抖音</option>
            </select>
          </label>
          <label>
            类型
            <select
              value={composer.type}
              onChange={(event) => setComposer({ ...composer, type: event.target.value as LiveEventType })}
            >
              <option value="danmaku">弹幕</option>
              <option value="gift">礼物</option>
              <option value="follow">关注</option>
              <option value="enter">进房</option>
              <option value="like">点赞</option>
            </select>
          </label>
        </div>
        <div className="fieldPair">
          <label>
            用户 ID
            <input
              value={composer.userId}
              onChange={(event) => setComposer({ ...composer, userId: event.target.value })}
            />
          </label>
          <label>
            昵称
            <input
              value={composer.userName}
              onChange={(event) => setComposer({ ...composer, userName: event.target.value })}
            />
          </label>
        </div>
        {composer.type === 'gift' ? (
          <div className="fieldPair">
            <label>
              礼物
              <input
                value={composer.giftName}
                onChange={(event) => setComposer({ ...composer, giftName: event.target.value })}
              />
            </label>
            <label>
              价值
              <input
                type="number"
                min="0"
                value={composer.giftValue}
                onChange={(event) => setComposer({ ...composer, giftValue: event.target.value })}
              />
            </label>
          </div>
        ) : (
          <label>
            内容
            <textarea
              rows={3}
              value={composer.content}
              onChange={(event) => setComposer({ ...composer, content: event.target.value })}
            />
          </label>
        )}
        <div className="roleToggles">
          <label>
            <input
              type="checkbox"
              checked={composer.isStreamer}
              onChange={(event) => setComposer({ ...composer, isStreamer: event.target.checked })}
            />
            主播
          </label>
          <label>
            <input
              type="checkbox"
              checked={composer.isAdmin}
              onChange={(event) => setComposer({ ...composer, isAdmin: event.target.checked })}
            />
            房管
          </label>
        </div>
        <button className="primaryButton" type="submit">
          <Send size={16} />
          发送事件
        </button>
      </form>
    </Panel>
  );
}

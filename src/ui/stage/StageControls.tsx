import { DesktopVoiceComposer } from '../voice/DesktopVoiceComposer';
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { Camera, Expand, Eye, EyeOff, History, Image, Lock, MessageSquare, Minus, MoreHorizontal, Move, Pin, Save, Settings2, Users, X } from 'lucide-react';
import type { CharacterProfile } from '../../character/characterProfiles';
import type { CharacterRenderConfig } from '../../character/vrm/CharacterRenderConfig';
import { isTauriDesktop, openMeetingWindow, openSettingsWindow, startDesktopWindowDrag } from '../../desktop/tauri/navigation';
import { minimizeStage, resizeStage, setStageOnTop, toggleStageFullscreen } from '../../desktop/tauri/stageWindow';
import { loadMeetingAutoTurnLimit, saveMeetingAutoTurnLimit, MEETING_AUTO_TURN_LIMIT_KEY, setMeetingDesktopCast, type MeetingSession } from '../meeting/meetingState';
import { sendStageMeetingCommand, STAGE_MEETING_CHANNEL, type StageMeetingCommand } from '../meeting/stageMeetingBridge';
import { LightingDialog } from '../settings/LightingDialog';
import { Button } from '../shared/ServantControls';
import { actorLighting, backgroundSource, defaultStageScene, loadSavedStages, stageBackgrounds, STAGE_IMAGES_KEY, STAGE_SAVES_KEY, type SavedStage, type StageScene } from './stageScene';
import { loadStageImages, uploadStageImage } from './stageImages';
import { actionLabel, emotionLabel, emotionSoundUrl } from './stagePresentation';
import { useTypewriter } from './useTypewriter';
import { type StageSegment } from './stageSegment';
import { playSfx, saveSfxVolume, stopAllSfx, unlockSfx } from '../../app/settings/sfxVolume';
import { useUiPreferences } from '../../app/settings/useUiPreferences';
import './stage.css';

type Panel = '角色' | '背景' | '功能' | '布局' | '历史' | '更多';
export interface StageLightingPreview { target: string; config: CharacterRenderConfig }
/**
 * 「正在回复…」的展示态，由多人对话窗口算出后广播过来。
 *
 * 舞台自己判不出来：消息一旦落库就是「已经说了」，是不是还在往外铺字只有
 * 那个持有打字机时间线的窗口知道。
 */
export interface StageActivity { sessionId: string; senderId: string; phase: 'thinking' | 'replying' }
export function StageControls({ scene, setScene, meeting, profiles, baseLighting, editing, setEditing, selectedId, setSelectedId, onPoseZoom, onLightingPreview, onScreenshot, activity, segment, error: externalError }: {
  scene: StageScene; setScene: Dispatch<SetStateAction<StageScene>>;
  meeting: MeetingSession; profiles: CharacterProfile[]; baseLighting: CharacterRenderConfig;
  editing: boolean; setEditing(value: boolean): void;
  selectedId: string; setSelectedId(value: string): void;
  onPoseZoom(id: string, zoom: number): void;
  onLightingPreview(value: StageLightingPreview | null): void;
  onScreenshot(): Promise<void>; activity: StageActivity | null;
  /** 正在播放的那一段；null 表示静置，对白框退回最后一条消息。 */
  segment: StageSegment | null; error: string;
}) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [hidden, setHidden] = useState(false);
  const [awake, setAwake] = useState(true);
  const [dialogue, setDialogue] = useState(true);
  const [fullscreen, setFullscreen] = useState(isTauriDesktop());
  const [onTop, setOnTop] = useState(isTauriDesktop());
  const [voiceSettingsOpen, setVoiceSettingsOpen] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);
  const [maxAutoTurns, setMaxAutoTurns] = useState(loadMeetingAutoTurnLimit);
  const [images, setImages] = useState(loadStageImages);
  const sfxVolume = useUiPreferences().sfxVolume;
  const [imageTab, setImageTab] = useState<'builtin' | 'mine'>('builtin');
  const [saves, setSaves] = useState(loadSavedStages);
  const [saveName, setSaveName] = useState('我的场景');
  const [lightTarget, setLightTarget] = useState<string | null>(null);
  const [playedSegments, setPlayedSegments] = useState<StageSegment[]>([]);
  const inputFile = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const people = new Map(profiles.map((profile) => [profile.id, profile]));
  const latest = meeting.messages.at(-1);
  const speaker = meeting.participants.includes(selectedId) ? selectedId : meeting.participants[0] ?? '';
  useEffect(() => {
    const syncLimit = (event: StorageEvent) => {
      if (event.key === MEETING_AUTO_TURN_LIMIT_KEY) setMaxAutoTurns(loadMeetingAutoTurnLimit());
    };
    window.addEventListener('storage', syncLimit);
    return () => window.removeEventListener('storage', syncLimit);
  }, []);
  const errorMessage = error || externalError;
  /**
   * 对白框显示哪一句：**正在播的那一段**优先，没有在播时才退回最后一条消息。
   *
   * 这个优先级不能反过来。一轮回复有几段，落库的 `messages` 是整轮一起写的，
   * 只看 `.at(-1)` 会让中间几句完全看不见；而播放结束后（`segment` 被清空）
   * 又必须退回消息列表，否则对白框会停在「最后播的那段」而不是「最后说的那句」。
   */
  const shown = segment
    ? { senderId: segment.characterId, text: segment.text, emotion: segment.emotion, shortAction: segment.shortAction, estimatedDurationMs: 0 }
    : latest
      ? {
          senderId: latest.senderId,
          text: latest.text,
          emotion: latest.emotion,
          shortAction: latest.shortAction,
          estimatedDurationMs: latest.estimatedDurationMs ?? 0
        }
      : null;
  useEffect(() => {
    if (!segment) {
      setPlayedSegments([]);
      return;
    }
    setPlayedSegments((current) =>
      segment.index === 0 || current[0]?.id !== segment.id
        ? [segment]
        : [...current.slice(0, segment.index), segment]
    );
  }, [segment]);
  // 名称牌：用户发言显示「你」，角色显示名字，开场前是占位文案。
  const speakerName = shown ? (shown.senderId === 'user' ? '你' : people.get(shown.senderId)?.name ?? '角色') : '等待开场';
  // 表情与动作只跟**角色**走：用户没有表情，(neutral) 按约定留空不显示。
  const emotionText = shown && shown.senderId !== 'user' ? emotionLabel(shown.emotion) : '';
  const actionText = shown && shown.senderId !== 'user' ? actionLabel(shown.shortAction) : '';
  /**
   * 打字机只对「刚出现的那句话」跑一次动画。
   *
   * `instant` 的三个条件都在说同一件事——**这句话不是刚刚说出来的**：
   * 用户发言（没有语音，跟着打反而怪）、开场占位、以及组件刚挂载时那一条
   * （刷新后重开舞台，历史最后一句不该从头再打一遍）。
   */
  const mountedMessageId = useRef(latest?.id ?? '');
  const typed = useTypewriter(shown?.text ?? '', {
    durationMs: shown?.estimatedDurationMs ?? 0,
    instant:
      !shown ||
      shown.senderId === 'user' ||
      // 已经开始播的这一段一定是「刚说的」，要打字；只有静置的历史最后一句才直接铺满。
      (!segment && meeting.messages.at(-1)?.id === mountedMessageId.current)
  });
  // 表情过场音：一段一个，挂在「换段」这个点上，而不是每帧。
  // 初始值取挂载时那条消息——进入舞台时对白框退回显示最后一条历史消息，那只是
  // 「显示」，不该把那条消息的情绪音重播一次（否则一进舞台就响一下 hihii.wav）。
  const lastSoundedKey = useRef(mountedMessageId.current);
  useEffect(() => {
    if (!shown || shown.senderId === 'user') return;
    const key = segment ? segment.id : latest?.id ?? '';
    if (!key || key === lastSoundedKey.current) return;
    lastSoundedKey.current = key;
    playSfx(emotionSoundUrl(shown.emotion));
  }, [latest?.id, segment, shown]);
  const activityHere = activity?.sessionId === meeting.id ? activity : null;
  const activityName = activityHere ? people.get(activityHere.senderId)?.name ?? '角色' : '';
  const patch = (value: Partial<StageScene>) => setScene((current) => ({ ...current, ...value }));
  const attempt = async (action: () => Promise<unknown>) => {
    setError('');
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败'); }
  };
  const toggleFullscreen = () => attempt(async () => setFullscreen(await toggleStageFullscreen()));
  const command = (command: StageMeetingCommand) => attempt(async () => {
    // 打断发言时，正在响的表情/打字音效也该一起停：它们是「这一句」的一部分，
    // 留着响完会显得打断没打干净。
    if (command.type === 'interrupt') stopAllSfx();
    setPending(true);
    try { await sendStageMeetingCommand(command); } finally { setPending(false); }
  });
  // 浏览器要求音频上下文必须由用户手势解锁。舞台是鼠标进进出出的地方，
  // 第一次按下就顺手解开，避免第一句台词的表情音因为没解锁而被静音。
  useEffect(() => {
    const unlock = () => unlockSfx();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);
  useEffect(() => {
    const channel = new BroadcastChannel(STAGE_MEETING_CHANNEL);
    channel.onmessage = ({ data }) => { if (data?.type === 'error' && data.sessionId === meeting.id && typeof data.error === 'string') setError(data.error); };
    return () => channel.close();
  }, [meeting.id]);
  useEffect(() => {
    const wake = () => { setAwake(true); clearTimeout(timer.current); timer.current = setTimeout(() => setAwake(false), 3200); };
    window.addEventListener('pointermove', wake);
    window.addEventListener('keydown', wake);
    wake();
    return () => { clearTimeout(timer.current); window.removeEventListener('pointermove', wake); window.removeEventListener('keydown', wake); };
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (document.querySelector('dialog[open]')) return;
      if (event.key === 'F11') { event.preventDefault(); void toggleFullscreen(); return; }
      if (event.key === 'Escape') {
        if (hidden) setHidden(false);
        else if (panel) setPanel(null);
        else if (editing) setEditing(false);
        else if (fullscreen) void toggleFullscreen();
      }
      if (!event.ctrlKey && !event.altKey && !event.metaKey && !(event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]')) && event.key.toLowerCase() === 'h') setHidden((current) => !current);
    };
    const changed = () => setFullscreen(Boolean(document.fullscreenElement));
    window.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', changed);
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('fullscreenchange', changed); };
  }, [hidden, panel, editing, fullscreen]);
  useEffect(() => {
    if (!isTauriDesktop()) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
      const current = getCurrentWindow();
      const refresh = async () => { const value = await current.isFullscreen(); if (!disposed) setFullscreen(value); };
      await refresh();
      const unlisten = await current.onResized(() => void refresh());
      if (disposed) unlisten(); else stop = unlisten;
    }).catch((cause) => setError(String(cause)));
    return () => { disposed = true; stop?.(); };
  }, []);
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.desktop-pet');
    if (root) root.dataset.stageUiHidden = String(hidden);
    return () => { if (root) delete root.dataset.stageUiHidden; };
  }, [hidden]);
  /*
    这里**不要**监听窗口焦点变化去 `setHidden(false)`。
    藏起界面之后点角色，窗口必然拿到焦点——那样「点一下角色界面就自己弹回来」，
    而藏起来本来就是为了能安静地摸头、让角色单独待在桌面上。
    恢复只认显式操作：按 H 切换（见上面 `onKey`）、按 Esc、或工具栏里的按钮。
  */
  const saveScene = () => {
    try {
      const save: SavedStage = { id: crypto.randomUUID(), name: saveName.trim() || '我的场景', scene: structuredClone(scene) };
      const next = [...saves, save];
      localStorage.setItem(STAGE_SAVES_KEY, JSON.stringify(next)); setSaves(next); setNotice('场景已保存');
    } catch { setError('场景保存失败，存储空间可能不足。'); }
  };
  const setPoseZoom = (zoom: number) => {
    onPoseZoom(speaker, zoom);
  };
  return <>
    <div className="galgame-ui" data-hidden={hidden} data-awake={awake || Boolean(panel) || editing || pending || Boolean(errorMessage)}>
      <header className="galgame-top">
        <div><span>STAGE / {editing ? 'EDIT' : 'LIVE'}</span><strong>{meeting.title}</strong></div>
        {!fullscreen && isTauriDesktop() && <Button data-window-drag onPointerDown={(event) => { if (event.button === 0) void startDesktopWindowDrag(); }}><Move size={15} /> 移动窗口</Button>}
        <div className="galgame-row">
          {isTauriDesktop() && <Button aria-label={onTop ? '取消窗口置顶' : '窗口置顶'} title={onTop ? '取消窗口置顶' : '窗口置顶'} aria-pressed={onTop} onClick={() => void attempt(async () => { await setStageOnTop(!onTop); setOnTop(!onTop); })}><Pin size={15} fill={onTop ? 'currentColor' : 'none'} /></Button>}
          <Button aria-pressed={editing} onClick={() => setEditing(!editing)}>{editing ? <Lock size={15} /> : <Move size={15} />}{editing ? '完成编辑' : '编辑布局'}</Button>
          <Button onClick={() => void toggleFullscreen()}><Expand size={15} />{fullscreen ? '退出全屏' : '全屏'}</Button>
          {isTauriDesktop() && <Button aria-label="最小化舞台" title="最小化舞台" onClick={() => void attempt(minimizeStage)}><Minus size={17} /></Button>}
          <Button aria-label="收起舞台，回到桌宠" onClick={() => setMeetingDesktopCast(null)}><X size={17} /></Button>
        </div>
      </header>
      <section hidden={!dialogue} className="galgame-dialogue" aria-label="舞台对话">
        <div className="galgame-dialogue-heading">
          <div className="galgame-dialogue-nameplate">
            <div className="galgame-dialogue-name">{speakerName}</div>
            {emotionText ? <span className="galgame-emotion">{emotionText}</span> : null}
            {actionText ? <span className="galgame-action">{actionText}</span> : null}
          </div>
        <div className="galgame-dialogue-heading-actions"><Button className="galgame-dialogue-hide" aria-label="隐藏对话框" title="隐藏对话框（可在更多中重新显示）" onClick={() => setDialogue(false)}><EyeOff size={15} /></Button><Button aria-label="语音设置" title="语音设置" aria-expanded={voiceSettingsOpen} onClick={() => setVoiceSettingsOpen(!voiceSettingsOpen)}><Settings2 size={15} /></Button></div></div>
        <p
          className="galgame-dialogue-text"
          data-typing={Boolean(latest) && !typed.done}
          aria-live="polite"
          aria-label={shown?.text || '选一个角色，开始你们的故事。'}
          onClick={typed.complete}
        >
          {latest
            ? segment
              ? [...playedSegments.filter((item) => item.id === segment.id && item.index < segment.index).map((item) => item.text), typed.shown].join('\n')
              : typed.shown
            : '选一个角色，开始你们的故事。'}
        </p>
        {activityHere ? <small>{activityName}{activityHere.phase === 'thinking' ? ' 正在整理想法…' : ' 正在回复…'}{activityHere.phase === 'replying' ? <> <button onClick={() => void command({ type: 'interrupt', sessionId: meeting.id })}>打断</button></> : null}</small> : null}
        <DesktopVoiceComposer meeting={meeting} profiles={profiles} speaker={speaker} setSpeaker={setSelectedId} settingsOpen={voiceSettingsOpen} onSettingsChange={setVoiceSettingsOpen} />

      </section>
      {panel && <aside className="galgame-panel" aria-label={`${panel}面板`}>
        <header><h2>{panel}</h2><Button aria-label="关闭面板" onClick={() => setPanel(null)}><X size={16} /></Button></header>
        {panel === '背景' && <>
          <div className="galgame-row"><Button aria-pressed={imageTab === 'builtin'} onClick={() => setImageTab('builtin')}>内置</Button><Button aria-pressed={imageTab === 'mine'} onClick={() => setImageTab('mine')}>我的图片</Button></div>
          <div className="galgame-backgrounds">{(imageTab === 'builtin' ? stageBackgrounds : images).map((item) => <button key={item.id} aria-pressed={scene.background === item.id} onClick={() => patch({ background: item.id })}>
            {backgroundSource(item.id) ? <img src={backgroundSource(item.id)} alt="" /> : <i /> }<span>{item.name}</span></button>)}</div>
          {imageTab === 'mine' && !images.length && <p>上传图片后会保存在本机，移动原图不影响使用。</p>}
          <Button disabled={pending} onClick={() => inputFile.current?.click()}>上传背景图片</Button>
          <input ref={inputFile} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={(event) => {
            const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
            void attempt(async () => { setPending(true); try {
              const image = await uploadStageImage(file); const next = [...images.filter((item) => item.id !== image.id), image];
              localStorage.setItem(STAGE_IMAGES_KEY, JSON.stringify(next)); setImages(next); patch({ background: image.id }); setImageTab('mine');
            } finally { setPending(false); } });
          }} />
          <label>显示方式<select value={scene.fit} onChange={(event) => patch({ fit: event.target.value as StageScene['fit'] })}><option value="cover">铺满裁切</option><option value="contain">完整显示</option></select></label>
          <StageRange label="水平裁切位置" value={scene.backgroundX} min={0} max={100} onChange={(backgroundX) => patch({ backgroundX })} />
          <StageRange label="垂直裁切位置" value={scene.backgroundY} min={0} max={100} onChange={(backgroundY) => patch({ backgroundY })} />
          <StageRange label="背景亮度" value={scene.brightness} min={0.2} max={1.5} step={0.05} onChange={(brightness) => patch({ brightness })} />
          <StageRange label="背景模糊" value={scene.blur} min={0} max={16} onChange={(blur) => patch({ blur })} />
          <h3>灯光</h3>
          <p>共同光照影响所有角色，角色外观只作用于选中的角色。</p>
          <Button onClick={() => setLightTarget('stage')}>调整整个舞台光照…</Button>
          <Button onClick={() => setLightTarget(speaker)}>调整 {people.get(speaker)?.name} 外观…</Button>
          <Button onClick={() => patch({ lighting: null })}>跟随角色设置中的光照</Button>
        </>}
        {panel === '功能' && <>
          <h3>多人讨论</h3>
          <p>控制这场多人讨论的发言和队列。</p>
          <label className="galgame-auto-turn-limit">自动选择最大轮数<input type="number" min={1} max={99} step={1} value={maxAutoTurns} onChange={(event) => {
            const value = event.currentTarget.valueAsNumber;
            if (Number.isFinite(value)) setMaxAutoTurns(saveMeetingAutoTurnLimit(value));
          }} /></label>
          <div className="galgame-meeting-controls">
            <Button disabled={pending || meeting.status !== 'active'} onClick={() => void command({ type: 'control', sessionId: meeting.id, action: 'pause' })}>暂停</Button>
            <Button disabled={pending || meeting.status !== 'paused'} onClick={() => void command({ type: 'control', sessionId: meeting.id, action: 'continue' })}>继续讨论</Button>
            <Button disabled={pending || meeting.status !== 'active'} onClick={() => void command({ type: 'control', sessionId: meeting.id, action: 'all' })}>全体讨论</Button>
            <Button disabled={pending || meeting.status !== 'active'} onClick={() => void command({ type: 'control', sessionId: meeting.id, action: 'auto' })}>自动选择</Button>
            <Button disabled={pending || meeting.status === 'ended'} variant="danger" onClick={() => void command({ type: 'interrupt', sessionId: meeting.id })}>打断</Button>
          </div>
        </>}
        {panel === '角色' && profiles.map((profile) => {
          const joined = meeting.participants.includes(profile.id), visible = !scene.hidden.includes(profile.id);
          return <div className="galgame-character-row" key={profile.id}>
            <Button aria-pressed={speaker === profile.id} disabled={!joined} onClick={() => setSelectedId(profile.id)}>{profile.name}</Button>
            {joined && <Button aria-label={`${visible ? '隐藏' : '显示'}${profile.name}`} onClick={() => patch({ hidden: visible ? [...scene.hidden, profile.id] : scene.hidden.filter((id) => id !== profile.id) })}>{visible ? '隐藏' : '显示'}</Button>}
            <Button disabled={pending || (joined && profile.isMain)} onClick={() => void command({ type: 'participant', sessionId: meeting.id, characterId: profile.id })}>{joined ? '移出' : '邀请'}</Button>
          </div>;
        })}
        {panel === '布局' && <>
          <Button aria-pressed={editing} onClick={() => setEditing(!editing)}>{editing ? '锁定布局' : '解锁并编辑'}</Button>
          <p>编辑时拖动角色；Ctrl＋滚轮缩放画面；空格＋拖动平移画面。</p>
          <StageRange label="画面缩放" value={scene.view.zoom} min={0.5} max={2} step={0.05} onChange={(zoom) => patch({ view: { ...scene.view, zoom } })} />
          <StageRange label="画面水平位置" value={scene.view.x} min={-50} max={50} onChange={(x) => patch({ view: { ...scene.view, x } })} />
          <StageRange label="画面垂直位置" value={scene.view.y} min={-50} max={50} onChange={(y) => patch({ view: { ...scene.view, y } })} />
          <label>当前角色<select value={speaker} onChange={(event) => setSelectedId(event.target.value)}>{meeting.participants.map((id) => <option key={id} value={id}>{people.get(id)?.name}</option>)}</select></label>
          <StageRange label="角色大小" value={scene.layout[speaker]?.zoom ?? 2} min={0.3} max={6} step={0.05} onChange={setPoseZoom} />
          <div className="galgame-row"><Button onClick={() => setPoseZoom(2)}>全身</Button><Button onClick={() => setPoseZoom(3.5)}>半身</Button></div>
          <Button onClick={() => patch({ layout: {}, hidden: [] })}>自动排列所有角色</Button>
          <Button onClick={() => patch({ layout: {}, view: { ...defaultStageScene.view } })}>画面复位</Button>
          <hr /><label>场景名称<input value={saveName} maxLength={60} onChange={(event) => setSaveName(event.target.value)} /></label>
          <Button onClick={saveScene}><Save size={14} /> 保存当前场景</Button>
          {saves.map((save) => <Button key={save.id} onClick={() => { setScene(structuredClone(save.scene)); setNotice(`已载入「${save.name}」`); }}>{save.name}</Button>)}
          <small>保存背景、站位、显隐、画面缩放和灯光；当前对话参与者不变。</small>
        </>}
        {panel === '历史' && <div className="galgame-history">{meeting.messages.length ? meeting.messages.map((message) => <article key={message.id}><strong>{message.senderId === 'user' ? '你' : people.get(message.senderId)?.name ?? '角色'}</strong><p>{message.text}</p></article>) : <p>还没有对话记录。</p>}</div>}
        {panel === '更多' && <>
          <StageRange label="音效音量" value={sfxVolume} min={0} max={1} step={0.05} onChange={saveSfxVolume} />
          <Button aria-pressed={dialogue} onClick={() => setDialogue(!dialogue)}><MessageSquare size={15} />{dialogue ? '隐藏对话框' : '显示对话框'}</Button>
          <Button onClick={() => { setPanel(null); setHidden(true); }}><Eye size={15} /> 隐藏界面 · H 恢复</Button>
          <Button disabled={pending} onClick={() => void attempt(async () => { setPending(true); try { await onScreenshot(); setNotice('舞台截图已下载'); } finally { setPending(false); } })}><Camera size={15} /> 保存纯净舞台截图</Button>
          <Button onClick={() => void openMeetingWindow()}>打开多人对话管理</Button>
          <Button onClick={() => void openSettingsWindow('tts')}>语音设置</Button>
        </>}
      </aside>}
      <nav className="galgame-toolbar" aria-label="舞台工具栏">{([
        ['角色', Users], ['背景', Image], ['功能', Settings2], ['布局', Move], ['历史', History], ['更多', MoreHorizontal]
      ] as const).map(([name, Icon]) => <Button key={name} aria-pressed={panel === name} onClick={() => setPanel(panel === name ? null : name)}><Icon size={17} />{name}</Button>)}</nav>
      {(errorMessage || notice) && <div className="galgame-notice" role={errorMessage ? 'alert' : 'status'}>{errorMessage || notice}<button aria-label="关闭提示" onClick={() => { setError(''); setNotice(''); }}>×</button></div>}
    </div>
    {!fullscreen && isTauriDesktop() && <div className="galgame-resize">{(['North', 'South', 'East', 'West', 'NorthEast', 'NorthWest', 'SouthEast', 'SouthWest'] as const).map((direction) => <div key={direction} data-edge={direction} onPointerDown={(event) => { if (event.button === 0) void attempt(() => resizeStage(direction)); }} />)}</div>}
    {lightTarget && <LightingDialog key={lightTarget} title={lightTarget === 'stage' ? '整个舞台 · 光照' : `${people.get(lightTarget)?.name ?? '角色'} · 外观`}
      stageOnly={lightTarget === 'stage'} appearanceOnly={lightTarget !== 'stage' && Boolean(scene.lighting)} value={lightTarget === 'stage' ? { ...baseLighting, ...scene.lighting } : actorLighting(scene, lightTarget, baseLighting)}
      onPreview={(config) => onLightingPreview(config ? { target: lightTarget, config } : null)}
      onApply={(config) => setScene((current) => lightTarget === 'stage' ? { ...current, lighting: { mainLightIntensity: config.mainLightIntensity, ambientLightIntensity: config.ambientLightIntensity, forceUnlitLighting: config.forceUnlitLighting } }
        : { ...current, characterLighting: { ...current.characterLighting, [lightTarget]: config } })}
      onClose={() => setLightTarget(null)} />}
  </>;
}

function StageRange({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange(value: number): void }) {
  return <label className="galgame-range"><span>{label}<output>{Number(value.toFixed(2))}</output></span><input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(event.target.valueAsNumber)} /></label>;
}

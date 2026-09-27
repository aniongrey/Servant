import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { Camera, Expand, Eye, History, Image, Lock, MessageSquare, MoreHorizontal, Move, Pin, Save, Sun, Users, X } from 'lucide-react';
import type { CharacterProfile } from '../../character/characterProfiles';
import type { CharacterRenderConfig } from '../../character/vrm/CharacterRenderConfig';
import { isTauriDesktop, openMeetingWindow, openSettingsWindow, startDesktopWindowDrag } from '../../desktop/tauri/navigation';
import { resizeStage, setStageOnTop, toggleStageFullscreen } from '../../desktop/tauri/stageWindow';
import { setMeetingDesktopCast, type MeetingSession } from '../meeting/meetingState';
import { sendStageMeetingCommand, STAGE_MEETING_CHANNEL, type StageMeetingCommand } from '../meeting/stageMeetingBridge';
import { LightingDialog } from '../settings/LightingDialog';
import { Button } from '../shared/ServantControls';
import { actorLighting, backgroundSource, defaultStageScene, loadSavedStages, stageBackgrounds, STAGE_IMAGES_KEY, STAGE_SAVES_KEY, type SavedStage, type StageScene } from './stageScene';
import { loadStageImages, uploadStageImage } from './stageImages';
import './stage.css';

type Panel = '角色' | '背景' | '灯光' | '布局' | '历史' | '更多';
export interface StageLightingPreview { target: string; config: CharacterRenderConfig }
export function StageControls({ scene, setScene, meeting, profiles, baseLighting, editing, setEditing, selectedId, setSelectedId, onPoseZoom, onLightingPreview, onScreenshot, error: externalError }: {
  scene: StageScene; setScene: Dispatch<SetStateAction<StageScene>>;
  meeting: MeetingSession; profiles: CharacterProfile[]; baseLighting: CharacterRenderConfig;
  editing: boolean; setEditing(value: boolean): void;
  selectedId: string; setSelectedId(value: string): void;
  onPoseZoom(id: string, zoom: number): void;
  onLightingPreview(value: StageLightingPreview | null): void;
  onScreenshot(): Promise<void>; error: string;
}) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [hidden, setHidden] = useState(false);
  const [awake, setAwake] = useState(true);
  const [dialogue, setDialogue] = useState(true);
  const [fullscreen, setFullscreen] = useState(isTauriDesktop());
  const [onTop, setOnTop] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);
  const [input, setInput] = useState('');
  const [images, setImages] = useState(loadStageImages);
  const [imageTab, setImageTab] = useState<'builtin' | 'mine'>('builtin');
  const [saves, setSaves] = useState(loadSavedStages);
  const [saveName, setSaveName] = useState('我的场景');
  const [lightTarget, setLightTarget] = useState<string | null>(null);
  const inputFile = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const people = new Map(profiles.map((profile) => [profile.id, profile]));
  const latest = meeting.messages.at(-1);
  const speaker = meeting.participants.includes(selectedId) ? selectedId : meeting.participants[0] ?? '';
  const errorMessage = error || externalError;
  const patch = (value: Partial<StageScene>) => setScene((current) => ({ ...current, ...value }));
  const attempt = async (action: () => Promise<unknown>) => {
    setError('');
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败'); }
  };
  const toggleFullscreen = () => attempt(async () => setFullscreen(await toggleStageFullscreen()));
  const command = (command: StageMeetingCommand) => attempt(async () => {
    setPending(true);
    try { await sendStageMeetingCommand(command); } finally { setPending(false); }
  });
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
          <Button aria-label="收起舞台，回到桌宠" onClick={() => setMeetingDesktopCast(null)}><X size={17} /></Button>
        </div>
      </header>
      {dialogue && <section className="galgame-dialogue" aria-label="舞台对话">
        <div className="galgame-dialogue-name">{latest ? latest.senderId === 'user' ? '你' : people.get(latest.senderId)?.name ?? '角色' : '等待开场'}</div>
        <div className="galgame-dialogue-text" aria-live="polite">{latest?.text || '选一个角色，开始你们的故事。'}</div>
        {meeting.queue.length > 0 && <small>{people.get(meeting.queue[0])?.name ?? '角色'} 正在回复… <button onClick={() => void command({ type: 'interrupt', sessionId: meeting.id })}>打断</button></small>}
        <form onSubmit={(event) => { event.preventDefault(); void attempt(async () => {
          setPending(true);
          try { await sendStageMeetingCommand({ type: 'send', sessionId: meeting.id, speakerId: speaker, text: input.trim() }); setInput(''); }
          finally { setPending(false); }
        }); }}>
          <select aria-label="说话对象" value={speaker} onChange={(event) => setSelectedId(event.target.value)}>{meeting.participants.map((id) => <option key={id} value={id}>{people.get(id)?.name ?? '角色'}</option>)}</select>
          <input aria-label="输入舞台消息" placeholder={meeting.status === 'paused' ? '对话已暂停' : '说点什么…'} maxLength={4000} value={input} onChange={(event) => setInput(event.target.value)} disabled={meeting.status !== 'active'} />
          <Button type="submit" disabled={!input.trim() || pending || meeting.queue.length > 0 || meeting.status !== 'active'}>发送</Button>
        </form>
      </section>}
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
          <small>背景图片亮度独立于角色光照。</small>
        </>}
        {panel === '角色' && profiles.map((profile) => {
          const joined = meeting.participants.includes(profile.id), visible = !scene.hidden.includes(profile.id);
          return <div className="galgame-character-row" key={profile.id}>
            <Button aria-pressed={speaker === profile.id} disabled={!joined} onClick={() => setSelectedId(profile.id)}>{profile.name}</Button>
            {joined && <Button aria-label={`${visible ? '隐藏' : '显示'}${profile.name}`} onClick={() => patch({ hidden: visible ? [...scene.hidden, profile.id] : scene.hidden.filter((id) => id !== profile.id) })}>{visible ? '隐藏' : '显示'}</Button>}
            <Button disabled={pending || (joined && profile.isMain)} onClick={() => void command({ type: 'participant', sessionId: meeting.id, characterId: profile.id })}>{joined ? '移出' : '邀请'}</Button>
          </div>;
        })}
        {panel === '灯光' && <>
          <p>共同光照影响所有角色，角色外观只作用于选中的角色。</p>
          <Button onClick={() => setLightTarget('stage')}>调整整个舞台光照…</Button>
          <Button onClick={() => setLightTarget(speaker)}>调整 {people.get(speaker)?.name} 外观…</Button>
          <Button onClick={() => patch({ lighting: null })}>跟随角色设置中的光照</Button>
        </>}
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
          <Button aria-pressed={dialogue} onClick={() => setDialogue(!dialogue)}><MessageSquare size={15} />{dialogue ? '隐藏对话框' : '显示对话框'}</Button>
          <Button onClick={() => { setPanel(null); setHidden(true); }}><Eye size={15} /> 隐藏界面 · H 恢复</Button>
          <Button disabled={pending} onClick={() => void attempt(async () => { setPending(true); try { await onScreenshot(); setNotice('舞台截图已下载'); } finally { setPending(false); } })}><Camera size={15} /> 保存纯净舞台截图</Button>
          <Button onClick={() => void openMeetingWindow()}>打开多人对话管理</Button>
          <Button onClick={() => void openSettingsWindow('tts')}>语音设置</Button>
        </>}
      </aside>}
      <nav className="galgame-toolbar" aria-label="舞台工具栏">{([
        ['角色', Users], ['背景', Image], ['灯光', Sun], ['布局', Move], ['历史', History], ['更多', MoreHorizontal]
      ] as const).map(([name, Icon]) => <Button key={name} aria-pressed={panel === name} onClick={() => setPanel(panel === name ? null : name)}><Icon size={17} />{name}</Button>)}</nav>
      {(errorMessage || notice) && <div className="galgame-notice" role={errorMessage ? 'alert' : 'status'}>{errorMessage || notice}<button aria-label="关闭提示" onClick={() => { setError(''); setNotice(''); }}>×</button></div>}
    </div>
    {hidden && <button className="galgame-restore" onClick={() => setHidden(false)}>显示界面 · H</button>}
    {!fullscreen && isTauriDesktop() && <div className="galgame-resize">{(['North', 'South', 'East', 'West', 'NorthEast', 'NorthWest', 'SouthEast', 'SouthWest'] as const).map((direction) => <div key={direction} data-edge={direction} onPointerDown={(event) => { if (event.button === 0) void attempt(() => resizeStage(direction)); }} />)}</div>}
    {lightTarget && <LightingDialog key={lightTarget} title={lightTarget === 'stage' ? '整个舞台 · 光照' : `${people.get(lightTarget)?.name ?? '角色'} · 外观`}
      stageOnly={lightTarget === 'stage'} appearanceOnly={lightTarget !== 'stage' && Boolean(scene.lighting)} value={lightTarget === 'stage' ? { ...baseLighting, ...scene.lighting } : actorLighting(scene, lightTarget, baseLighting)}
      onPreview={(config) => onLightingPreview(config ? { target: lightTarget, config } : null)}
      onApply={(config) => setScene((current) => lightTarget === 'stage' ? { ...current, lighting: { mainLightIntensity: config.mainLightIntensity, ambientLightIntensity: config.ambientLightIntensity } }
        : { ...current, characterLighting: { ...current.characterLighting, [lightTarget]: config } })}
      onClose={() => setLightTarget(null)} />}
  </>;
}

function StageRange({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange(value: number): void }) {
  return <label className="galgame-range"><span>{label}<output>{Number(value.toFixed(2))}</output></span><input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(event.target.valueAsNumber)} /></label>;
}

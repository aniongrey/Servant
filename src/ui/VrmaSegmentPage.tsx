import { useEffect, useMemo, useRef, useState } from 'react';
import './vrma-editor.css';
import * as THREE from 'three';
import { ChevronDown, ChevronRight, FileVideo, Folder } from 'lucide-react';
import { Pause, Play, RotateCcw, Save, Square, Trash2 } from 'lucide-react';
import characterConfig from '../character/vrm/assets/default-character.json';
import { backendFetch } from '../app/network/backendFetch';
import { resolveVrmModelOption } from '../character/vrm/assets/vrmModels';
import {
  allVrmaSegmentBodyParts,
  vrmaSegmentBodyParts,
  vrmaSegmentQuickParts,
  type BodyPart,
  type LoopMode,
  type VrmaLoopConfig,
  type VrmaSegment,
  type VrmaSegmentConfig
} from '../character/motion/assets/vrmaSegments';
import { VrmaLoader } from '../character/motion/VrmaLoader';
import { VrmModelLoader } from '../character/vrm/VrmModelLoader';
import type { MotionMeta } from '../app/runtimeTypes';
import { bundledVrmaClips } from '../character/motion/assets/vrmaAssetFiles';
import { EmotionConsole } from './EmotionConsole';

const FPS = 30;
// The build-time clip list is the same one the debug panel and the runtime use;
// `/api/vrma-files` only prunes it down to what is actually on disk.
const bundledVrmaOptions = bundledVrmaClips.map((clip) => ({ name: clip.name, url: clip.url }));
const defaultModel = resolveVrmModelOption(characterConfig.id);

type PlayMode = 'full' | 'segment' | 'paused' | 'stopped';

interface VrmaTreeNodeData {
  name: string;
  path: string;
  kind: 'directory' | 'file';
  children?: VrmaTreeNodeData[];
}

function buildVrmaTree(options: readonly { name: string }[]): VrmaTreeNodeData[] {
  const root: VrmaTreeNodeData[] = [];
  for (const option of options) {
    const segments = option.name.split('/');
    let nodes = root;
    let path = '';
    segments.forEach((name, index) => {
      path = path ? `${path}/${name}` : name;
      const kind = index === segments.length - 1 ? 'file' : 'directory';
      let node = nodes.find((item) => item.name === name && item.kind === kind);
      if (!node) {
        node = { name, path, kind, children: kind === 'directory' ? [] : undefined };
        nodes.push(node);
      }
      nodes = node.children ?? [];
    });
  }
  const sort = (nodes: VrmaTreeNodeData[]) => {
    nodes.sort(
      (a, b) =>
        Number(b.kind === 'directory') - Number(a.kind === 'directory') || a.name.localeCompare(b.name)
    );
    nodes.forEach((node) => node.children && sort(node.children));
  };
  sort(root);
  return root;
}

function VrmaTreeNode({
  node,
  selected,
  expanded,
  onToggle,
  onSelect,
  depth = 0
}: {
  node: VrmaTreeNodeData;
  selected: string;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  depth?: number;
}) {
  const isOpen = expanded.has(node.path);
  if (node.kind === 'file')
    return (
      <button
        type="button"
        className={`vrma-tree-file${selected === node.path ? ' selected' : ''}`}
        style={{ paddingLeft: `${12 + depth * 18}px` }}
        onClick={() => onSelect(node.path)}
      >
        <FileVideo size={14} />
        {node.path.split('/').pop()}
      </button>
    );
  return (
    <div className="vrma-tree-directory">
      <button
        type="button"
        className="vrma-tree-folder"
        style={{ paddingLeft: `${8 + depth * 18}px` }}
        onClick={() => onToggle(node.path)}
      >
        {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <Folder size={14} />
        {node.name}
      </button>
      {isOpen &&
        node.children?.map((child) => (
          <VrmaTreeNode
            key={child.path}
            node={child}
            selected={selected}
            expanded={expanded}
            onToggle={onToggle}
            onSelect={onSelect}
            depth={depth + 1}
          />
        ))}
    </div>
  );
}

export function VrmaSegmentPage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const vrmRef = useRef<Awaited<ReturnType<VrmModelLoader['load']>> | null>(null);
  const actionRef = useRef<THREE.AnimationAction | null>(null);
  const clipRef = useRef<THREE.AnimationClip | null>(null);
  const frameRef = useRef(0);
  const endFrameRef = useRef(0);
  const playbackStartRef = useRef(0);
  const playbackEndRef = useRef(0);
  const loopModeRef = useRef<LoopMode>('none');
  const blendFramesRef = useRef(10);
  const totalFramesRef = useRef(0);
  const pendingSegmentRef = useRef<{ vrma: string; segment: VrmaSegment } | null>(null);
  const playModeRef = useRef<PlayMode>('stopped');
  const [vrmaOptions, setVrmaOptions] = useState(bundledVrmaOptions);
  const [selectedVrma, setSelectedVrma] = useState(bundledVrmaOptions[0]?.name ?? '');
  const [loadedVrma, setLoadedVrma] = useState('');
  const [startFrame, setStartFrameState] = useState(1);
  const [endFrame, setEndFrameState] = useState(1);
  const [totalFrames, setTotalFrames] = useState(0);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [description, setDescription] = useState('');
  const [parts, setParts] = useState<BodyPart[]>(allVrmaSegmentBodyParts);
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(() => new Set());
  const [savedSegments, setSavedSegments] = useState<VrmaSegmentConfig>({});
  const [editing, setEditing] = useState<{ vrma: string; index: number; original: VrmaSegment } | null>(null);
  const [status, setStatus] = useState('正在初始化…');
  const [modelReady, setModelReady] = useState(false);
  const [workspace, setWorkspace] = useState('emotion');
  const [loopMode, setLoopMode] = useState<LoopMode>('none');
  const [blendFrames, setBlendFrames] = useState(10);
  endFrameRef.current = endFrame;
  totalFramesRef.current = totalFrames;
  loopModeRef.current = loopMode;
  blendFramesRef.current = blendFrames;

  useEffect(() => {
    let disposed = false;
    let animationFrame = 0;
    const abort = new AbortController();
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 20);
    camera.position.set(0, 0.78, 3.4);
    camera.lookAt(0, 0.78, 0);
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    const clock = new THREE.Clock();
    renderer.setClearColor(0x000000, 0);
    const ambient = new THREE.HemisphereLight(0xffffff, 0x6f7892, 2.2);
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(2, 4, 3);
    scene.add(ambient, key);
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
      camera.aspect = Math.max(1, rect.width) / Math.max(1, rect.height);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    void new VrmModelLoader()
      .load(defaultModel.url, abort.signal)
      .then((vrm) => {
        if (disposed) return;
        vrm.scene.rotation.y = vrm.meta.metaVersion === '0' ? Math.PI : 0;
        scene.add(vrm.scene);
        vrmRef.current = vrm;
        mixerRef.current = new THREE.AnimationMixer(vrm.scene);
        setStatus('模型已加载');
        setModelReady(true);
      })
      .catch((error: unknown) => {
        if (!disposed) setStatus(error instanceof Error ? error.message : String(error));
      });
    const loop = () => {
      const mixer = mixerRef.current;
      const action = actionRef.current;
      const delta = Math.min(0.05, clock.getDelta());
      if (mixer && action && playModeRef.current !== 'paused' && playModeRef.current !== 'stopped') {
        mixer.update(delta);
        const frame = Math.floor(action.time * FPS) + playbackStartRef.current;
        frameRef.current = frame;
        setCurrentFrame(frame);
        const limit = playbackEndRef.current || totalFramesRef.current;
        if (loopModeRef.current === 'none' && frame >= limit) {
          action.stop();
          playModeRef.current = 'stopped';
          setCurrentFrame(limit);
        }
      }
      vrmRef.current?.update(delta);
      renderer.render(scene, camera);
      animationFrame = requestAnimationFrame(loop);
    };
    loop();
    return () => {
      disposed = true;
      abort.abort();
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
      actionRef.current?.stop();
      renderer.dispose();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const option = vrmaOptions.find((item) => item.name === selectedVrma);
    const mixer = mixerRef.current;
    if (!option || !mixer || !modelReady) return undefined;
    actionRef.current?.stop();
    clipRef.current = null;
    setLoadedVrma('');
    setStatus(`正在加载 ${option.name}…`);
    const meta: MotionMeta = {
      id: `segment-editor-${option.name}`,
      url: option.url,
      loop: 'once',
      defaultFadeIn: 0,
      defaultFadeOut: 0,
      interruptible: true,
      returnToIdle: false,
      tags: [],
      durationMs: 0
    };
    const vrm = vrmRef.current;
    if (!vrm) return undefined;
    void new VrmaLoader(vrm)
      .load(meta)
      .then((loaded) => {
        if (cancelled || !loaded.clip) return;
        actionRef.current?.stop();
        clipRef.current = loaded.clip;
        const frames = Math.ceil(loaded.clip.duration * FPS);
        setTotalFrames(frames);
        setStartFrameState(1);
        setEndFrameState(Math.max(1, frames));
        const action = mixer.clipAction(loaded.clip);
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
        actionRef.current = action;
        setLoadedVrma(option.name);
        setStatus(`${option.name} · ${frames} 帧 / ${loaded.clip.duration.toFixed(2)} 秒`);
        const pending = pendingSegmentRef.current;
        if (pending?.vrma === option.name) {
          pendingSegmentRef.current = null;
          setStartFrameState(pending.segment.start);
          setEndFrameState(pending.segment.end);
          play('segment', pending.segment.start, pending.segment.end);
        } else {
          play('full', 0, frames);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setStatus(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [selectedVrma, modelReady]);

  useEffect(() => {
    void backendFetch('/api/vrma-files')
      .then((response) =>
        response.ok
          ? (response.json() as Promise<{ files?: string[] }>)
          : Promise.reject(new Error('VRMA 目录读取失败'))
      )
      .then((payload) => {
        const names = new Set(payload.files ?? []);
        const options = bundledVrmaOptions.filter((item) => names.has(item.name));
        if (options.length > 0) {
          setVrmaOptions(options);
          setSelectedVrma((current) => (names.has(current) ? current : options[0].name));
        }
      })
      .catch(() => setStatus('VRMA 目录读取失败，使用构建时资源列表'));
    void backendFetch('/api/vrma-segments')
      .then((response) => (response.ok ? (response.json() as Promise<VrmaSegmentConfig>) : {}))
      .then(setSavedSegments)
      .catch(() => setStatus('动作配置读取失败'));
  }, []);

  useEffect(() => {
    const onLoop = (event: Event) => {
      const value = (event as CustomEvent<VrmaLoopConfig>).detail;
      loopModeRef.current = value.mode;
      blendFramesRef.current = value.blendFrames ?? 10;
      setLoopMode(value.mode);
      setBlendFrames(value.blendFrames ?? 10);
    };
    window.addEventListener('vrma-loop-config', onLoop);
    return () => window.removeEventListener('vrma-loop-config', onLoop);
  }, []);

  function play(mode: 'full' | 'segment', start = startFrame, end = endFrame) {
    const mixer = mixerRef.current;
    const sourceClip = clipRef.current;
    if (!mixer || !sourceClip) return;
    const isSegment = mode === 'segment';
    const rangeStart = isSegment ? start / FPS : 0;
    const rangeEnd = isSegment ? end / FPS : sourceClip.duration;
    const slicedClip = sliceClip(sourceClip, rangeStart, rangeEnd);
    const clip =
      loopModeRef.current === 'blend' ? makeBlendClip(slicedClip, blendFramesRef.current, FPS) : slicedClip;
    actionRef.current?.stop();
    const action = mixer.clipAction(clip);
    playbackStartRef.current = isSegment ? start : 0;
    playbackEndRef.current = playbackStartRef.current + Math.ceil(clip.duration * FPS);
    action.reset();
    action.enabled = true;
    action.setLoop(
      loopModeRef.current === 'repeat' || loopModeRef.current === 'blend'
        ? THREE.LoopRepeat
        : loopModeRef.current === 'pingpong'
        ? THREE.LoopPingPong
        : THREE.LoopOnce,
      loopModeRef.current === 'none' ? 1 : Infinity
    );
    action.clampWhenFinished = true;
    action.paused = false;
    action.time = 0;
    action.play();
    actionRef.current = action;
    playModeRef.current = mode;
    setCurrentFrame(playbackStartRef.current);
    const loopLabel =
      loopModeRef.current === 'blend' ? `blend · ${blendFramesRef.current} 帧` : loopModeRef.current;
    setStatus(
      mode === 'segment' ? `播放片段 ${start} → ${end} · ${loopLabel}` : `播放完整动作 · ${loopLabel}`
    );
  }
  function previewFrame(frame: number) {
    const nextFrame = Math.max(0, Math.min(totalFrames, Math.floor(frame)));
    const action = actionRef.current;
    if (action) {
      action.reset();
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
      action.paused = true;
      action.time = nextFrame / FPS;
      mixerRef.current?.update(0);
      vrmRef.current?.update(0);
    }
    playModeRef.current = 'paused';
    setCurrentFrame(nextFrame);
  }
  function setStartFrame(value: number) {
    const nextStart = Math.max(1, Math.min(totalFrames, Math.floor(Number.isFinite(value) ? value : 1)));
    setStartFrameState(nextStart);
    if (nextStart > endFrame) setEndFrameState(nextStart);
    previewFrame(nextStart);
  }
  function setEndFrame(value: number) {
    const nextEnd = Math.max(startFrame, Math.min(totalFrames, Math.floor(Number.isFinite(value) ? value : startFrame)));
    setEndFrameState(nextEnd);
    previewFrame(nextEnd);
  }
  function togglePart(part: BodyPart) {
    setParts((current) =>
      current.includes(part) ? current.filter((item) => item !== part) : [...current, part]
    );
  }
  function applyQuickParts(label: string) {
    setParts((current) => [...new Set([...current, ...vrmaSegmentQuickParts[label]])]);
  }
  function selectVrma(name: string) {
    setEditing(null);
    pendingSegmentRef.current = null;
    setDescription('');
    setParts([...allVrmaSegmentBodyParts]);
    setLoopMode('none');
    window.dispatchEvent(new CustomEvent('vrma-loop-config', { detail: { mode: 'none' } }));
    if (name === selectedVrma) { setStartFrame(1); setEndFrame(totalFrames); return; }
    setSelectedVrma(name);
    setLoadedVrma('');
    actionRef.current?.stop();
    clipRef.current = null;
    setCurrentFrame(0);
    setTotalFrames(0);
  }
  function selectSavedSegment(vrma: string, segment: VrmaSegment, index: number) {
    setEditing({ vrma, index, original: segment });
    const editableSegment = { ...segment, start: Math.max(1, segment.start), end: Math.max(1, segment.end) };
    setStartFrameState(editableSegment.start);
    setEndFrameState(editableSegment.end);
    setDescription(segment.description);
    setParts(segment.parts);
    setLoopMode(String(segment.loop?.mode) === 'once' ? 'none' : segment.loop?.mode ?? 'none');
    setBlendFrames(segment.loop?.blendFrames ?? 10);
    window.dispatchEvent(new CustomEvent('vrma-loop-config', { detail: segment.loop ?? { mode: 'none' } }));
    if (vrma === selectedVrma && actionRef.current) {
      play('segment', editableSegment.start, editableSegment.end);
      return;
    }
    pendingSegmentRef.current = { vrma, segment: editableSegment };
    setSelectedVrma(vrma);
  }
  async function saveSegment() {
    if (
      !selectedVrma ||
      !Number.isInteger(startFrame) ||
      !Number.isInteger(endFrame) ||
      startFrame < 1 ||
      endFrame < startFrame ||
      endFrame > totalFrames ||
      parts.length === 0
    ) {
      setStatus('保存失败：请检查 VRMA、帧范围和身体部位');
      return;
    }
    setStatus('正在保存…');
    const loop = loopMode === 'blend' ? { mode: loopMode, blendFrames } : { mode: loopMode };
    const response = await backendFetch('/api/vrma-segments', {
      method: editing ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index: editing?.index, original: editing?.original, vrma: selectedVrma, start: startFrame, end: endFrame, description, parts, loop })
    });
    if (!response.ok) {
      setStatus((await response.json().catch(() => ({}))).error ?? '保存失败');
      return;
    }
    const replacement: VrmaSegment = { start: startFrame, end: endFrame, description: description.trim(), parts: [...parts], loop };
    if (editing) {
      const result = await response.json();
      setSavedSegments(result.segments);
      window.dispatchEvent(new CustomEvent('vrma-segment-updated', { detail: { file: selectedVrma, original: editing.original, replacement } }));
      setEditing({ ...editing, original: replacement });
      setStatus('片段更新成功，组合动作引用已同步');
      return;
    }
    setEditing({ vrma: selectedVrma, index: (savedSegments[selectedVrma] ?? []).length, original: replacement });
    setSavedSegments((current) => ({
      ...current,
      [selectedVrma]: [
        ...(current[selectedVrma] ?? []),
        { start: startFrame, end: endFrame, description: description.trim(), parts: [...parts], loop }
      ]
    }));
    setStatus('新增动作保存成功');
  }
  async function deleteSegment(vrma: string, index: number) {
    if (!window.confirm(`确定删除 ${vrma} 的动作${index + 1} 吗？`)) return;
    const response = await backendFetch('/api/vrma-segments', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vrma, index })
    });
    if (!response.ok) {
      setStatus((await response.json()).error ?? '删除失败');
      return;
    }
    setSavedSegments((current) => {
      const next = { ...current, [vrma]: [...(current[vrma] ?? [])] };
      next[vrma].splice(index, 1);
      if (next[vrma].length === 0) delete next[vrma];
      return next;
    });
    setEditing((current) => !current || current.vrma !== vrma ? current : current.index === index ? null : { ...current, index: current.index > index ? current.index - 1 : current.index });
    setStatus('动作删除成功');
  }

  const duration = totalFrames / FPS;
  const vrmaTree = useMemo(() => buildVrmaTree(vrmaOptions), [vrmaOptions]);
  return (
    <main className="vrma-editor-page">
      <header className="vrma-editor-header">
        <div>
          <span className="eyebrow">MOTION WORKSHOP</span>
          <h1>动作工作台</h1>
          <p>组合动作、表情与微动作，让角色的每次表达更自然。</p>
        </div>
        <div className="vrma-header-actions"><span className="vrma-model-status">{modelReady ? "模型已就绪" : "模型加载中"}</span><a href="/" className="vrma-back-link">
          返回主界面
        </a></div>
      </header>
      <section className="vrma-workspace">
        <div className="vrma-preview-panel">
          <div className="vrma-stage-heading"><span>角色预览</span><span>{workspace === "emotion" ? "EMOTION COMPOSER" : "VRMA SEGMENT"}</span></div>
          <div className="vrma-preview-stage">
            <canvas ref={canvasRef} />
          </div>
          <div className="vrma-preview-toolbar" hidden={workspace === "emotion"}>
            <span className="vrma-preview-file">
              预览：
              {loadedVrma
                ? loadedVrma
                : `${selectedVrma || '未选择'}（加载中）`}
            </span>
            <span>
              {currentFrame} / {totalFrames} 帧
            </span>
            <span>
              {(currentFrame / FPS).toFixed(2)}s / {duration.toFixed(2)}s
            </span>
            <input
              aria-label="当前播放进度"
              type="range"
              min={0}
              max={Math.max(0, totalFrames)}
              value={Math.min(currentFrame, totalFrames)}
              onChange={(event) => {
                const frame = Number(event.currentTarget.value);
                if (actionRef.current) {
                  actionRef.current.time = frame / FPS;
                  setCurrentFrame(frame);
                }
              }}
            />
            <button type="button" onClick={() => play('full')}>
              <Play size={15} />
              完整动作
            </button>
            <button type="button" onClick={() => play('segment')}>
              <Play size={15} />
              播放片段
            </button>
            <button
              type="button"
              onClick={() => {
                playModeRef.current = 'paused';
                setStatus('已暂停');
              }}
            >
              <Pause size={15} />
              暂停
            </button>
            <button
              type="button"
              onClick={() => {
                actionRef.current?.stop();
                if (actionRef.current) actionRef.current.time = startFrame / FPS;
                setCurrentFrame(startFrame);
                playModeRef.current = 'stopped';
              }}
            >
              <Square size={15} />
              停止
            </button>
          </div>
        </div>
        <aside className="vrma-inspector">
          <nav className="vrma-workspace-nav" aria-label="工作台视图">
            {[['emotion', '组合动作'], ['segment', '片段切分'], ['library', '片段库']].map(([key, label]) =>
              <button type="button" key={key} aria-pressed={workspace === key} onClick={() => setWorkspace(key)}>{label}</button>
            )}
          </nav>
          <div className="vrma-inspector-pane" hidden={workspace !== 'emotion'}>
            <EmotionConsole vrm={modelReady ? vrmRef.current : null} segments={savedSegments} visible={workspace === 'emotion'} onStopSegment={() => {
              actionRef.current?.stop(); playModeRef.current = 'stopped';
            }} />
          </div>
          <div className="vrma-inspector-pane vrma-library-pane" hidden={workspace !== 'library'}>
            <SegmentList segments={savedSegments} onSelect={(file, segment, index) => { setWorkspace('segment'); selectSavedSegment(file, segment, index); }} onDelete={deleteSegment} />
          </div>
          <div className="vrma-inspector-pane vrma-cut-pane" hidden={workspace !== 'segment'}>
      <div className="vrma-cut-layout">
      <section className="vrma-editor-grid">
        <div className="vrma-editor-card">
          <div className="vrma-section-title">
            <div>
              <span className="eyebrow">SEGMENT EDITOR</span>
              <h2>动作片段编辑 / 保存</h2>
            </div>
            <span className="vrma-status" role="status">{status}</span>
          </div>
          <div className="vrma-file-picker">
            <span className="vrma-field-label">VRMA</span>
            <div className="vrma-selected-file">{selectedVrma || '没有可用的 VRMA'}</div>
            <div className="vrma-file-tree">
              {vrmaTree.map((node) => (
                <VrmaTreeNode
                  key={node.path}
                  node={node}
                  selected={selectedVrma}
                  expanded={expandedDirectories}
                  onToggle={(path) =>
                    setExpandedDirectories((current) => {
                      const next = new Set(current);
                      next.has(path) ? next.delete(path) : next.add(path);
                      return next;
                    })
                  }
                  onSelect={selectVrma}
                />
              ))}
            </div>
          </div>
          <div className="vrma-frame-grid">
            <label>
              开始帧
              <input
                type="number"
                min={1}
                max={Math.max(1, totalFrames)}
                disabled={totalFrames < 1}
                value={startFrame}
                onChange={(event) => setStartFrame(Number(event.target.value))}
              />
              <input
                type="range"
                min={1}
                max={Math.max(1, totalFrames)}
                disabled={totalFrames < 1}
                value={startFrame}
                onChange={(event) => setStartFrame(Number(event.target.value))}
              />
            </label>
            <label>
              结束帧
              <input
                type="number"
                min={1}
                max={Math.max(1, totalFrames)}
                disabled={totalFrames < 1}
                value={endFrame}
                onChange={(event) => setEndFrame(Number(event.target.value))}
              />
              <input
                type="range"
                min={1}
                max={Math.max(1, totalFrames)}
                disabled={totalFrames < 1}
                value={endFrame}
                onChange={(event) => setEndFrame(Number(event.target.value))}
              />
            </label>
          </div>
          <label>
            说明
            <textarea
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="例如：抬起右手挥手"
            />
          </label>
          <div className="vrma-playback-options">
            <label>
              循环模式
              <select
                value={loopMode}
                onChange={(event) => {
                  const mode = event.target.value as LoopMode;
                  setLoopMode(mode);
                  window.dispatchEvent(
                    new CustomEvent<VrmaLoopConfig>('vrma-loop-config', { detail: { mode, blendFrames } })
                  );
                }}
              >
                <option value="none">none · 播放一次</option>
                <option value="repeat">repeat · 直接循环</option>
                <option value="pingpong">pingpong · 正放反放</option>
                <option value="blend">blend · 融合首尾</option>
              </select>
            </label>
            {loopMode === 'blend' ? (
              <label>
                Blend 帧数
                <input
                  className="vrma-blend-input"
                  type="number"
                  min={1}
                  max={120}
                  value={blendFrames}
                  onChange={(event) => {
                    const frames = Math.max(1, Number(event.target.value));
                    setBlendFrames(frames);
                    window.dispatchEvent(
                      new CustomEvent<VrmaLoopConfig>('vrma-loop-config', {
                        detail: { mode: 'blend', blendFrames: frames }
                      })
                    );
                  }}
                />
              </label>
            ) : null}
          </div>
          <div className="vrma-part-heading">
            <span>身体部位（默认全选）</span>
            <div className="vrma-quick-actions">
              <button type="button" onClick={() => setParts([...allVrmaSegmentBodyParts])}>
                全选
              </button>
              <button type="button" onClick={() => setParts([])}>
                清空
              </button>
              {Object.keys(vrmaSegmentQuickParts).map((label) => (
                <button type="button" key={label} onClick={() => applyQuickParts(label)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="vrma-parts">
            {vrmaSegmentBodyParts.map((part) => (
              <label key={part}>
                <input type="checkbox" checked={parts.includes(part)} onChange={() => togglePart(part)} />
                {part}
              </label>
            ))}
          </div>
        </div>
      </section>
      <aside className="vrma-current-segments">
        <SegmentList title="当前 VRMA 片段" segments={selectedVrma && savedSegments[selectedVrma]?.length ? { [selectedVrma]: savedSegments[selectedVrma] } : {}} editing={editing} onSelect={selectSavedSegment} onDelete={deleteSegment} />
      </aside>
      </div>
          <div className="vrma-editor-actions">
            <button type="button" onClick={() => play('segment')}>
              <Play size={16} />
              播放片段
            </button>
            <button className="primary" type="button" onClick={saveSegment}>
              <Save size={16} />
              {editing ? '更新片段' : '保存新片段'}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setLoopMode('none');
                window.dispatchEvent(new CustomEvent('vrma-loop-config', { detail: { mode: 'none' } }));
                setStartFrame(1);
                setEndFrame(totalFrames);
                setDescription('');
                setParts([...allVrmaSegmentBodyParts]);
              }}
            >
              <RotateCcw size={16} />
              新建
            </button>
          </div>

          </div>
        </aside>
      </section>
    </main>
  );
}

function SegmentList({
  segments,
  onSelect,
  onDelete,
  title = '已保存动作',
  editing
}: {
  title?: string;
  editing?: { vrma: string; index: number } | null;
  segments: VrmaSegmentConfig;
  onSelect: (vrma: string, segment: VrmaSegment, index: number) => void;
  onDelete: (vrma: string, index: number) => void;
}) {
  return (
    <div className="vrma-editor-card saved-segments">
      <div className="vrma-section-title">
        <div>
          <span className="eyebrow">LIBRARY</span>
          <h2>{title}</h2>
        </div>
        <span className="vrma-muted">点击片段载入编辑</span>
      </div>
      {Object.entries(segments).length === 0 ? (
        <p className="vrma-empty">还没有保存的动作片段。</p>
      ) : (
        Object.entries(segments).map(([vrma, items]) => (
          <div className="vrma-saved-row" key={vrma}>
            <strong>{vrma}</strong>
            <div>
              {items.map((segment, index) => (
                <span className="vrma-segment-button" key={`${vrma}-${index}`}>
                  <button
                    type="button"
                    title={`${segment.start} → ${segment.end}\n${segment.description}\n${segment.parts.join(
                      '、'
                    )}\n循环：${segment.loop?.mode ?? 'none'}`}
                    aria-pressed={editing?.vrma === vrma && editing.index === index}
                    onClick={() => onSelect(vrma, segment, index)}
                  >
                    <span className="vrma-segment-description">
                      {segment.description || `动作${index + 1}`}
                    </span>
                    <small>
                      {segment.start} → {segment.end} · {segment.loop?.mode ?? 'none'}
                    </small>
                  </button>
                  <button
                    className="vrma-delete-button"
                    type="button"
                    aria-label={`删除${vrma}动作${index + 1}`}
                    title="删除"
                    onClick={() => onDelete(vrma, index)}
                  >
                    <Trash2 size={14} />
                  </button>
                </span>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function sliceClip(clip: THREE.AnimationClip, start: number, end: number): THREE.AnimationClip {
  const tracks = clip.tracks.map((track) => {
    const valueSize = track.getValueSize();
    const sourceTimes = Array.from(track.times as ArrayLike<number>);
    const sourceValues = Array.from(track.values as ArrayLike<number>);
    const interpolant = track as THREE.KeyframeTrack & {
      createInterpolant(result: Float32Array): { evaluate(time: number): ArrayLike<number> };
    };
    const sample = (time: number) => {
      const index = sourceTimes.findIndex((value) => Math.abs(value - time) < 0.0001);
      return index >= 0
        ? sourceValues.slice(index * valueSize, index * valueSize + valueSize)
        : Array.from(interpolant.createInterpolant(new Float32Array(valueSize)).evaluate(time));
    };
    const times = [0];
    const values = sample(start);
    sourceTimes.forEach((time, index) => {
      if (time > start && time < end) {
        times.push(time - start);
        values.push(...sourceValues.slice(index * valueSize, index * valueSize + valueSize));
      }
    });
    times.push(end - start);
    values.push(...sample(end));
    const TrackConstructor = track.constructor as new (
      name: string,
      times: number[],
      values: number[]
    ) => THREE.KeyframeTrack;
    return new TrackConstructor(track.name, times, values);
  });
  return new THREE.AnimationClip(`${clip.name}_segment`, Math.max(0, end - start), tracks);
}

function makeBlendClip(clip: THREE.AnimationClip, blendFrames: number, fps: number): THREE.AnimationClip {
  const blendDuration = Math.max(1, Math.floor(blendFrames)) / fps;
  const tracks = clip.tracks.map((track) => {
    const size = track.getValueSize();
    const values = Array.from(track.values as ArrayLike<number>);
    const first = values.slice(0, size);
    const last = values.slice(values.length - size);
    const sourceTimes = Array.from(track.times as ArrayLike<number>);
    const times = [...sourceTimes];
    const outputValues = [...values];
    const lastTime = sourceTimes[sourceTimes.length - 1] ?? 0;
    if (lastTime < clip.duration - 0.00001) {
      times.push(clip.duration);
      outputValues.push(...last);
    }
    for (let index = 1; index <= Math.max(1, Math.floor(blendFrames)); index += 1) {
      const alpha = index / Math.max(1, Math.floor(blendFrames));
      const eased = THREE.MathUtils.smoothstep(alpha, 0, 1);
      let sample = last.map((value, valueIndex) =>
        THREE.MathUtils.lerp(value, first[valueIndex] ?? value, eased)
      );
      if (track instanceof THREE.QuaternionKeyframeTrack && size === 4) {
        const from = new THREE.Quaternion(last[0], last[1], last[2], last[3]).normalize();
        const to = new THREE.Quaternion(first[0], first[1], first[2], first[3]).normalize();
        if (from.dot(to) < 0) to.set(-to.x, -to.y, -to.z, -to.w);
        const result = from.slerp(to, eased);
        sample = [result.x, result.y, result.z, result.w];
      }
      times.push(clip.duration + alpha * blendDuration);
      outputValues.push(...sample);
    }
    const TrackConstructor = track.constructor as new (
      name: string,
      times: number[],
      values: number[]
    ) => THREE.KeyframeTrack;
    return new TrackConstructor(track.name, times, outputValues);
  });
  return new THREE.AnimationClip(`${clip.name}_blend`, clip.duration + blendDuration, tracks);
}

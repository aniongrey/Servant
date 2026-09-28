import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Sun, X } from 'lucide-react';
import { defaultCharacterRenderConfig, type CharacterRenderConfig } from '../../character/vrm/CharacterRenderConfig';
import { CharacterLightingSettings } from './CharacterLightingSettings';
import { ControlRange } from './SettingsControls';
import { Button } from '../shared/ServantControls';
import './lighting-dialog.css';

export function LightingDialog({ value, title = '灯光与外观', stageOnly = false, appearanceOnly = false, previewBackground, preview, onPreview, onApply, onClose }: {
  value: CharacterRenderConfig;
  title?: string;
  stageOnly?: boolean;
  appearanceOnly?: boolean;
  previewBackground?: string;
  preview?: (config: CharacterRenderConfig) => ReactNode;
  onPreview?: (config: CharacterRenderConfig | null) => void;
  onApply(config: CharacterRenderConfig): void;
  onClose(): void;
}) {
  const [original] = useState(value);
  const [draft, setDraft] = useState(value);
  const [compare, setCompare] = useState(false);
  const [sceneBackground, setSceneBackground] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const effective = compare ? original : draft;
  const previewRef = useRef(onPreview);
  previewRef.current = onPreview;
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => { element.close(); previewRef.current?.(null); };
  }, []);
  useEffect(() => { previewRef.current?.(effective); }, [effective]);
  return createPortal(
    <dialog ref={dialog} className={`lighting-dialog ${preview ? '' : 'lighting-dialog--stage'}`} aria-labelledby={id}
      onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <header><div><span>LIVE PREVIEW</span><h2 id={id}><Sun size={19} /> {title}</h2></div>
        <Button aria-label="关闭灯光设置" onClick={onClose}><X size={18} /></Button></header>
      <div className="lighting-dialog-body">
        {preview && <div className="lighting-preview" style={sceneBackground && previewBackground ? { backgroundImage: `url("${previewBackground}")`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}>{preview(effective)}
          <small>拖动旋转 · 滚轮缩放 {previewBackground && <Button onClick={() => setSceneBackground(!sceneBackground)}>{sceneBackground ? '中性背景' : '当前场景'}</Button>}</small></div>}
        <div className="lighting-controls">
          <p>{stageOnly ? '实时预览整个舞台的共同光照。角色材质保持独立。' : '实时预览当前角色；应用后保存，取消恢复原效果。'}</p>
          {appearanceOnly && <p>主光和补光由舞台统一控制，请在“整个舞台光照”中调整。</p>}
          {!appearanceOnly && <><div className="lighting-presets">
            {[['柔和日光', 2.4, 0.9], ['明亮室内', 3.2, 1.15], ['夜景', 1.1, 0.38]].map(([name, main, ambient]) =>
              <Button key={name} onClick={() => setDraft((current) => ({ ...current, mainLightIntensity: Number(main), ambientLightIntensity: Number(ambient) }))}>{name}</Button>)}
          </div>
          <Button aria-pressed={draft.forceUnlitLighting} onClick={() => setDraft((current) => ({ ...current, forceUnlitLighting: !current.forceUnlitLighting }))}>强制光线影响：{draft.forceUnlitLighting ? '开' : '关'}</Button>
          <small>让不受光材质响应灯光。默认关闭，保留模型原效果。</small>
          <ControlRange label="主光亮度" min={0.5} max={4} step={0.05} value={draft.mainLightIntensity} onChange={(value) => setDraft((current) => ({ ...current, mainLightIntensity: value }))} />
          <ControlRange label="环境补光" min={0} max={1.4} step={0.02} value={draft.ambientLightIntensity} onChange={(value) => setDraft((current) => ({ ...current, ambientLightIntensity: value }))} />
          </>}
          {!stageOnly && <details open={appearanceOnly}><summary>高级参数 · 轮廓光 / 阴影 / 材质</summary><CharacterLightingSettings hideBasic renderConfig={draft} setRenderConfig={setDraft} /></details>}
        </div>
      </div>
      <footer>
        <Button aria-pressed={compare} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setCompare(true); }}
          onPointerUp={() => setCompare(false)} onPointerCancel={() => setCompare(false)} onLostPointerCapture={() => setCompare(false)}
          onKeyDown={(event) => { if (event.key === ' ' || event.key === 'Enter') setCompare(true); }}
          onKeyUp={() => setCompare(false)} onBlur={() => setCompare(false)}>按住看原效果</Button>
        <Button onClick={() => setDraft({ ...defaultCharacterRenderConfig })}>恢复默认</Button>
        <Button onClick={onClose}>取消</Button>
        <Button variant="primary" onClick={() => { onApply(draft); onClose(); }}>应用</Button>
      </footer>
    </dialog>, document.body
  );
}

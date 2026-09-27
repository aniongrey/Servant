import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent
} from 'react';
import { Check, ImagePlus, Plus, Trash2, UserRound, UsersRound, MonitorUp } from 'lucide-react';
import { loadCharacterSkillLibrary, selectCharacterSkill, type CharacterSkillLibrary } from '../../ai/personality/CharacterSkill';
import { loadVoiceLibrary } from '../../ai/tts/localVoiceLibrary';
import { makeCharacterProfile, saveCharacterProfiles, loadCharacterProfiles, CHARACTER_AVATARS, avatarFor, type CharacterProfile } from '../../character/characterProfiles';
import { avatarImageSource, uploadAvatarImage } from '../../app/network/avatarImageClient';
import { loadAvatarFitConfig } from '../../character/ik/avatarFitSettings';
import { loadCharacterRenderConfig } from '../../character/vrm/characterRenderSettings';
import { loadCharacterProportionConfig } from '../../character/vrm/characterProportionSettings';
import { HOLD_MICRO_MOTION_ENABLED_STORAGE_KEY, FOOT_IK_ENABLED_STORAGE_KEY, DEFAULT_HOLD_MICRO_MOTION_ENABLED, DEFAULT_FOOT_IK_ENABLED } from '../../app/settings/storageKeys';
import { publishDesktopCharacter } from '../../desktop/tauri/publishDesktopCharacter';
import { Button, Dialog, SelectInput, TextInput } from '../shared/ServantControls';
import { useVrmLibrary } from './useVrmLibrary';
import './character-profiles.css';
import './avatar-crop.css';

export function CharacterProfilesSettings() {
  const { models, importedModels, modelsLoaded, selectLibraryModel } = useVrmLibrary();
  const [profiles, setProfiles] = useState<CharacterProfile[]>(loadCharacterProfiles);
  const [cards, setCards] = useState<CharacterSkillLibrary['cards']>([]);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState('');
  const [switchingProfileId, setSwitchingProfileId] = useState('');
  const [cropProfileId, setCropProfileId] = useState('');
  const [cropSource, setCropSource] = useState('');
  const [cropZoom, setCropZoom] = useState(1);
  const [cropPosition, setCropPosition] = useState({ x: 0.5, y: 0.5 });
  const [cropReady, setCropReady] = useState(false);
  const [cropBusy, setCropBusy] = useState(false);
  const [cropError, setCropError] = useState('');
  const cropDrag = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const cropImage = useRef<HTMLImageElement>(null);
  const voices = useMemo(loadVoiceLibrary, []);
  const seeded = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    void loadCharacterSkillLibrary(controller.signal)
      .then((library) => { if (!controller.signal.aborted) setCards(library.cards); })
      .catch((error: unknown) => { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : '角色卡列表读取失败'); })
      .finally(() => { if (!controller.signal.aborted) setReady(true); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!ready || !modelsLoaded || seeded.current || profiles.length) return;
    seeded.current = true;
    const profile = makeCharacterProfile({
      id: 'main', name: '主角色', avatarId: 'girl-01', isMain: true,
      characterCardId: cards[0]?.id ?? 'builtin', vrmId: models[0]?.id || 'main',
      voiceId: voices[0]?.id ?? ''
    });
    commit([profile]);
  }, [ready, modelsLoaded, profiles.length, cards, models, voices]);

  const commit = (next: CharacterProfile[]) => {
    setProfiles(next);
    saveCharacterProfiles(next);
    window.dispatchEvent(new Event('servant:character-profiles-changed'));
  };
  const update = (id: string, patch: Partial<CharacterProfile>) =>
    commit(profiles.map((profile) => profile.id === id ? { ...profile, ...patch } : profile));
  const publishProfileModel = async (vrmId: string) => {
    const model = models.find((item) => item.id === vrmId);
    if (!model) throw new Error('默认角色绑定的 VRM 模型不存在。');
    const imported = importedModels.find((item) => item.id === vrmId);
    await publishDesktopCharacter({
      version: 1,
      model: { id: vrmId },
      avatarFit: loadAvatarFitConfig(),
      renderConfig: loadCharacterRenderConfig(),
      proportionConfig: loadCharacterProportionConfig(),
      holdMicroMotionEnabled: localStorage.getItem(HOLD_MICRO_MOTION_ENABLED_STORAGE_KEY) === null ? DEFAULT_HOLD_MICRO_MOTION_ENABLED : localStorage.getItem(HOLD_MICRO_MOTION_ENABLED_STORAGE_KEY) === 'true',
      footIkEnabled: localStorage.getItem(FOOT_IK_ENABLED_STORAGE_KEY) === null ? DEFAULT_FOOT_IK_ENABLED : localStorage.getItem(FOOT_IK_ENABLED_STORAGE_KEY) === 'true'
    }, imported ? { id: imported.id, blob: imported.blob } : null, new AbortController().signal);
  };
  const selectDefaultProfile = async (profile: CharacterProfile) => {
    const model = models.find((item) => item.id === profile.vrmId);
    if (!model) return setMessage('默认角色绑定的 VRM 模型不存在。');
    selectLibraryModel(profile.vrmId);
    setSwitchingProfileId(profile.id);
    setMessage('正在应用默认聊天角色…');
    commit(profiles.map((item) => ({ ...item, isMain: item.id === profile.id })));
    try {
      await Promise.all([
        selectCharacterSkill(profile.characterCardId),
        publishProfileModel(profile.vrmId)
      ]);
      setMessage(`已应用默认聊天角色「${profile.name}」，桌面舞台已同步。`);
    } catch (error) {
      setMessage(`默认角色已保存；同步失败：${error instanceof Error ? error.message : '请重试'}`);
    } finally { setSwitchingProfileId(''); }
  };
  const add = () => {
    if (profiles.length >= 8) return setMessage('最多支持 8 个角色。');
    const profile = makeCharacterProfile({
      name: `角色 ${profiles.length + 1}`, characterCardId: cards[0]?.id ?? 'builtin',
      vrmId: models[0]?.id ?? 'main', voiceId: voices[0]?.id ?? ''
    });
    commit([...profiles, profile]);
  };
  useEffect(() => () => { if (cropSource) URL.revokeObjectURL(cropSource); }, [cropSource]);

  const chooseAvatar = (profileId: string) => {
    setCropProfileId(profileId);
    setCropError('');
    if (uploadInput.current) uploadInput.current.value = '';
    uploadInput.current?.click();
  };
  const selectImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setCropError('请选择 PNG、JPG 或 WebP 图片。');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setCropError('图片不能超过 15 MB。');
      return;
    }
    setCropReady(false);
    setCropZoom(1);
    setCropPosition({ x: 0.5, y: 0.5 });
    setCropSource(URL.createObjectURL(file));
  };
  const saveCroppedAvatar = async () => {
    const image = cropImage.current;
    if (!image?.naturalWidth || !cropProfileId) return;
    if (image.naturalWidth * image.naturalHeight > 50_000_000) {
      setCropError('图片分辨率过大，请选择较小的图片。');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 512;
    const context = canvas.getContext('2d');
    if (!context) return setCropError('无法处理这张图片。');
    const side = Math.min(image.naturalWidth, image.naturalHeight) / cropZoom;
    context.drawImage(image, (image.naturalWidth - side) * cropPosition.x, (image.naturalHeight - side) * cropPosition.y, side, side, 0, 0, 512, 512);
    const cropped = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.9));
    if (!cropped) return setCropError('图片裁剪失败，请重试。');
    setCropBusy(true); setCropError('');
    try {
      const avatarId = await uploadAvatarImage(cropped);
      update(cropProfileId, { avatarId });
      setCropSource(''); setCropProfileId('');
    } catch (error) {
      setCropError(error instanceof Error ? error.message : '头像上传失败，请检查服务端连接。');
    } finally { setCropBusy(false); }
  };

  const updateCropPosition = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = cropDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;
    setCropPosition((position) => ({
      x: Math.max(0, Math.min(1, position.x - dx / rect.width / cropZoom)),
      y: Math.max(0, Math.min(1, position.y - dy / rect.height / cropZoom))
    }));
    event.preventDefault();
  };
  const startCropDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    cropDrag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  const endCropDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (cropDrag.current?.pointerId !== event.pointerId) return;
    cropDrag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const zoomCrop = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    setCropZoom((zoom) => Math.max(1, Math.min(3, zoom * Math.exp(-event.deltaY * 0.001))));
  };

  return (
    <section className="aurelia-panel aurelia-character-profiles">
      <div className="character-profiles-heading">
        <div><span>CHARACTER BINDINGS</span><h2>角色管理</h2><p>创建角色并绑定角色卡、音色和 VRM 模型。</p></div>
        <div className="character-profiles-heading-actions">
          <Button className="aurelia-primary-button" disabled={profiles.length >= 8} onClick={add} type="button" variant="primary"><Plus size={15} />创建角色</Button>
        </div>
      </div>
      <div className="character-profiles-grid">
        {profiles.map((profile) => {
          const avatar = avatarFor(profile.avatarId);
          const avatarImage = avatarImageSource(profile.avatarId, avatar.image);
          const model = models.find((item) => item.id === profile.vrmId);
          return (
            <article className="character-profile-card" key={profile.id}>
              <div className="character-profile-model">
                <div className={`character-profile-avatar avatar-${avatar.id}`}><span aria-hidden="true">{avatar.symbol}</span><img src={avatarImage} alt={`${profile.name}头像`} onError={(event) => { const image = event.currentTarget; if (!image.dataset.fallback) { image.dataset.fallback = 'true'; image.src = avatar.image; } else image.hidden = true; }} /></div>
                <Button className="character-avatar-upload" onClick={() => chooseAvatar(profile.id)} type="button"><ImagePlus size={13} />自定义头像</Button>
                <div className="character-profile-model-name"><span>VRM 模型</span><strong>{model?.name ?? '尚未绑定'}</strong></div>
                {profile.isMain ? <span className="character-main-badge"><UserRound size={12} />主角色</span> : null}
              </div>
              <div className="character-profile-bindings">
                <label><span>角色名称</span><TextInput maxLength={32} value={profile.name} onChange={(event) => update(profile.id, { name: event.currentTarget.value })} onBlur={() => { if (!profile.name.trim()) update(profile.id, { name: '未命名角色' }); }} /></label>
                <label><span>头像</span><SelectInput value={profile.avatarId} onChange={(event) => update(profile.id, { avatarId: event.currentTarget.value })}>{profile.avatarId.startsWith('custom:') ? <option value={profile.avatarId}>自定义头像</option> : null}{CHARACTER_AVATARS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</SelectInput></label>
                <label><span>关联角色卡</span><SelectInput value={profile.characterCardId} onChange={(event) => update(profile.id, { characterCardId: event.currentTarget.value })}>{cards.map((card) => <option key={card.id} value={card.id}>{card.config.displayName} · {card.fileName}</option>)}</SelectInput></label>
                <label><span>关联音色</span><SelectInput value={profile.voiceId} onChange={(event) => update(profile.id, { voiceId: event.currentTarget.value })}><option value="">使用当前语音设置</option>{voices.map((voice) => <option key={voice.id} value={voice.id}>{voice.name} · {voice.voice}</option>)}</SelectInput></label>
                <label><span>关联 VRM 模型</span><SelectInput value={profile.vrmId} onChange={(event) => { const vrmId = event.currentTarget.value; update(profile.id, { vrmId }); if (profile.isMain) void publishProfileModel(vrmId).catch((error) => setMessage(`主 VRM 同步失败：${error instanceof Error ? error.message : '请重试'}`)); }}>{models.map((item) => <option key={item.id} value={item.id}>{item.name}{item.source === 'builtin' ? ' · 内置' : ' · 导入'}</option>)}</SelectInput></label>
                <div className="character-profile-actions"><span>{profile.isMain ? <><UsersRound size={13} />默认聊天角色 · 桌面舞台</> : <Button disabled={switchingProfileId !== '' || !modelsLoaded} onClick={() => void selectDefaultProfile(profile)} type="button"><MonitorUp size={13} />设为默认聊天角色</Button>}</span>{!profile.isMain ? <Button aria-label={`删除${profile.name}`} onClick={() => commit(profiles.filter((item) => item.id !== profile.id))} type="button" variant="danger"><Trash2 size={14} />删除</Button> : null}</div>
              </div>
            </article>
          );
        })}
      </div>
      {profiles.length === 0 ? <p className="character-profiles-empty">正在读取角色卡和模型库…</p> : null}
      {message ? <p className="aurelia-field-hint" role="status">{message}</p> : null}
      <input ref={uploadInput} accept="image/png,image/jpeg,image/webp" hidden onChange={selectImage} type="file" />
      {cropSource ? <Dialog className="avatar-crop-dialog" description="拖动图片调整位置，滚轮缩放。" onClose={() => { setCropSource(''); setCropProfileId(''); setCropError(''); }} title="调整并裁剪" actions={<><Button onClick={() => { setCropSource(''); setCropProfileId(''); }} type="button">取消</Button><Button disabled={!cropReady || cropBusy} onClick={() => void saveCroppedAvatar()} type="button" variant="primary">{cropBusy ? '正在上传…' : <><Check size={15} />裁剪并保存</>}</Button></>}><div className="avatar-crop-frame" onPointerCancel={endCropDrag} onPointerDown={startCropDrag} onPointerMove={updateCropPosition} onPointerUp={endCropDrag} onWheel={zoomCrop}>{cropReady ? null : <span>正在读取图片…</span>}<img ref={cropImage} alt="头像裁剪预览" onError={() => setCropError('无法读取图片，请重新选择。')} onLoad={(event) => { const target = event.currentTarget; if (target.naturalWidth * target.naturalHeight > 50_000_000) setCropError('图片分辨率过大，请选择较小的图片。'); else setCropReady(true); }} src={cropSource} style={{ objectPosition: `${cropPosition.x * 100}% ${cropPosition.y * 100}%`, transform: `scale(${cropZoom})` }} /></div>{cropError ? <p className="avatar-crop-error" role="alert">{cropError}</p> : null}</Dialog> : null}
    </section>
  );
}

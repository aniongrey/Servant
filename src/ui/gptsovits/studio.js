'use strict';

/* ==================================================================
 * GPT-SoVITS 语音配置中心 · 前端
 *
 * 从 gpt-sovtest 原型整体搬入，UI 与交互保持原样。
 * 与 Shiro 的唯一耦合点在文件顶部：API 地址由 main.ts 解析出的后端
 * origin 拼成，打包版后端跑在随机回环端口上，页面 origin 是
 * tauri.localhost，所以不能直接用页面相对路径的 /api/*。
 * ================================================================== */

/** Shiro 后端 origin（打包版为 http://127.0.0.1:<port>，开发版为空串）。 */
const API_ORIGIN =
  (typeof globalThis !== 'undefined' && globalThis.__SHIRO_API_ORIGIN__) || '';

const EMOTIONS = [
  ['neutral', '普通'],
  ['happy', '开心'],
  ['shy', '害羞'],
  ['sad', '悲伤'],
  ['angry', '生气'],
  ['curious', '好奇'],
  ['concerned', '关切'],
];
const EMOTION_KEYS = EMOTIONS.map((e) => e[0]);
const EMOTION_LABEL = Object.fromEntries(EMOTIONS);
/** MVP 只开放「普通」，其余情绪保留结构但禁用 */
const ENABLED_EMOTIONS = new Set(['neutral']);

const LANGS = [
  ['zh', '中文'], ['en', '英文'], ['ja', '日文'], ['yue', '粤语'], ['ko', '韩文'],
  ['auto', '自动'], ['auto_yue', '自动（粤语优先）'], ['all_zh', '全中文'], ['all_ja', '全日文'],
];

const SPLIT_METHODS = [
  ['cut0', 'cut0 · 不切'],
  ['cut1', 'cut1 · 凑 50 字'],
  ['cut2', 'cut2 · 按中文句号'],
  ['cut3', 'cut3 · 按英文句号'],
  ['cut4', 'cut4 · 按分号'],
  ['cut5', 'cut5 · 按标点（推荐）'],
];

const ADV_PARAMS = [
  { key: 'top_k', label: 'top_k', type: 'number', step: 1 },
  { key: 'top_p', label: 'top_p', type: 'number', step: 0.05, min: 0, max: 1 },
  { key: 'temperature', label: 'temperature', type: 'number', step: 0.05, min: 0, max: 2 },
  { key: 'repetition_penalty', label: 'repetition_penalty', type: 'number', step: 0.05, min: 0.8, max: 2 },
  { key: 'text_split_method', label: '切句方式', type: 'select', options: SPLIT_METHODS },
  { key: 'batch_size', label: 'batch_size', type: 'number', step: 1, min: 1, max: 200 },
  { key: 'batch_threshold', label: 'batch_threshold', type: 'number', step: 0.05, min: 0, max: 1 },
  { key: 'split_bucket', label: 'split_bucket', type: 'bool' },
  { key: 'parallel_infer', label: 'parallel_infer', type: 'bool' },
  { key: 'super_sampling', label: 'super_sampling', type: 'bool' },
  { key: 'sample_steps', label: 'sample_steps', type: 'number', step: 1, min: 1, max: 256 },
  { key: 'fragment_interval', label: 'fragment_interval', type: 'number', step: 0.05, min: 0, max: 5 },
  { key: 'seed', label: 'seed（-1 为随机）', type: 'number', step: 1 },
];

const DEFAULT_SETTINGS = {
  top_k: 15, top_p: 1, temperature: 1, speed_factor: 1,
  text_split_method: 'cut5', batch_size: 1, batch_threshold: 0.75,
  split_bucket: true, repetition_penalty: 1.35, seed: -1,
  parallel_infer: true, sample_steps: 32, super_sampling: false,
  fragment_interval: 0.3, streaming_mode: 0,
};

/* ---------------- 运行时状态 ---------------- */
const S = {
  root: '',
  profiles: [],
  apiUrl: '',
  loaded: { gpt: '', sovits: '' },
  current: null,
  snapshot: '',
  emotion: 'neutral',
  models: { gpt: [], sovits: [] },
  busy: false,
  lastAudioUrl: '',
};

const API = `${API_ORIGIN}/api/gpt-sovits`;

const $ = (id) => document.getElementById(id);

/* ---------------- 通用工具 ---------------- */
function blankProfile(name) {
  return {
    id: `role-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: name || '新角色',
    models: { gpt: '', sovits: '' },
    text_lang: 'zh',
    references: {},
    settings: { ...DEFAULT_SETTINGS },
  };
}

function clone(o) { return JSON.parse(JSON.stringify(o)); }

function setNotice(el, kind, text) {
  if (!el) return;
  if (!text) { el.hidden = true; el.textContent = ''; return; }
  el.hidden = false;
  el.className = `notice ${kind || ''}`;
  el.textContent = text; // textContent：不插入 HTML
}

function fmtMs(ms) {
  if (ms == null) return '—';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`;
}

async function api(path, opts = {}) {
  const res = await fetch(API + path, Object.assign({ headers: {} }, opts));
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    const text = await res.text();
    throw new Error(text.slice(0, 400) || `HTTP ${res.status}`);
  }
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || json.detail || `HTTP ${res.status}`);
  return json;
}

function isDirty() {
  return !!S.current && JSON.stringify(S.current) !== S.snapshot;
}

function refreshDirty() {
  const flag = $('dirty-flag');
  if (flag) flag.hidden = !isDirty();
}

/* ---------------- 初始化下拉 ---------------- */
function fillSelect(el, options, placeholder) {
  el.textContent = '';
  if (placeholder != null) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = placeholder;
    el.appendChild(o);
  }
  for (const [value, label] of options) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    el.appendChild(o);
  }
}

/* ---------------- 渲染：角色列表 ---------------- */
function renderRoleList() {
  const ul = $('role-list');
  ul.textContent = '';
  for (const p of S.profiles) {
    const li = document.createElement('li');
    li.className = 'role-item' + (S.current && p.id === S.current.id ? ' is-active' : '');

    const nameSpan = document.createElement('span');
    nameSpan.className = 'role-name';
    nameSpan.textContent = p.name;

    const emoSpan = document.createElement('span');
    emoSpan.className = 'role-em';
    const n = Object.values(p.references || {}).filter((r) => r && r.audio).length;
    emoSpan.textContent = `${n}/7`;

    li.appendChild(nameSpan);
    li.appendChild(emoSpan);
    li.addEventListener('click', () => selectProfile(p.id));
    ul.appendChild(li);
  }
}

/* ---------------- 渲染：模型快速填写下拉 ---------------- */
function modelOption(it) {
  const o = document.createElement('option');
  o.value = it.path;
  o.textContent = it.label; // 上一层级目录名/文件名，与官方 WebUI 一致
  o.title = it.path;
  return o;
}

function fillModelPicker(el, items) {
  el.textContent = '';
  const o0 = document.createElement('option');
  o0.value = '';
  o0.textContent = items.length ? '选择…' : '未扫描';
  el.appendChild(o0);
  el.disabled = !items.length;
  if (!items.length) return;

  const presets = items.filter((i) => i.preset);
  if (presets.length) {
    const g = document.createElement('optgroup');
    g.label = '预训练底模';
    for (const it of presets) g.appendChild(modelOption(it));
    el.appendChild(g);
  }

  const groups = new Map();
  for (const it of items.filter((i) => !i.preset)) {
    if (!groups.has(it.version)) groups.set(it.version, []);
    groups.get(it.version).push(it);
  }
  for (const [version, list] of groups) {
    const g = document.createElement('optgroup');
    g.label = version;
    for (const it of list) g.appendChild(modelOption(it));
    el.appendChild(g);
  }
  el.value = '';
}

/* ---------------- 渲染：情绪 tabs ---------------- */
function renderEmotionTabs() {
  const box = $('emo-tabs');
  box.textContent = '';
  for (const [key, label] of EMOTIONS) {
    const enabled = ENABLED_EMOTIONS.has(key);
    const b = document.createElement('button');
    b.className = 'tab' + (key === S.emotion ? ' is-active' : '') + (enabled ? '' : ' is-disabled');
    b.disabled = !enabled;
    b.title = enabled ? '' : '本版暂不支持该情绪';
    const ref = S.current?.references?.[key];
    if (ref && ref.audio) b.classList.add('has-ref');

    const dot = document.createElement('span');
    dot.className = 'tab-dot';
    const t = document.createElement('span');
    t.textContent = label;
    b.appendChild(dot);
    b.appendChild(t);
    if (!enabled) {
      const lock = document.createElement('span');
      lock.className = 'tab-lock';
      lock.textContent = '暂不支持';
      b.appendChild(lock);
    }
    if (enabled) {
      b.addEventListener('click', () => {
        S.emotion = key;
        renderEmotionTabs();
        renderReference();
      });
    }
    box.appendChild(b);
  }
}

function renderReference() {
  const ref = S.current?.references?.[S.emotion] || { audio: '', text: '', lang: 'zh' };
  $('f-ref-audio').value = ref.audio || '';
  $('f-ref-text').value = ref.text || '';
  $('f-ref-lang').value = ref.lang || 'zh';
}

function syncReferenceFromForm() {
  if (!S.current) return;
  if (!S.current.references) S.current.references = {};
  S.current.references[S.emotion] = {
    audio: $('f-ref-audio').value.trim(),
    text: $('f-ref-text').value,
    lang: $('f-ref-lang').value || 'zh',
  };
  // 清理完全空的项
  const r = S.current.references[S.emotion];
  if (!r.audio && !r.text) delete S.current.references[S.emotion];
  renderEmotionTabs();
  refreshDirty();
}

/* ---------------- 渲染：高级参数 ---------------- */
function renderAdvParams() {
  const box = $('adv-params');
  box.textContent = '';
  for (const p of ADV_PARAMS) {
    const wrap = document.createElement('div');
    wrap.className = 'param' + (p.type === 'bool' ? ' param-check' : '');

    const label = document.createElement('span');
    label.className = 'field-label';
    label.textContent = p.label;

    let input;
    if (p.type === 'select') {
      input = document.createElement('select');
      fillSelect(input, p.options, null);
      input.value = S.current?.settings?.[p.key] ?? DEFAULT_SETTINGS[p.key];
    } else if (p.type === 'bool') {
      input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !!(S.current?.settings?.[p.key] ?? DEFAULT_SETTINGS[p.key]);
      wrap.appendChild(label);
      wrap.appendChild(input);
      input.addEventListener('change', () => {
        S.current.settings[p.key] = input.checked;
        refreshDirty();
      });
      box.appendChild(wrap);
      continue;
    } else {
      input = document.createElement('input');
      input.type = 'number';
      input.step = String(p.step ?? 1);
      if (p.min != null) input.min = String(p.min);
      if (p.max != null) input.max = String(p.max);
      input.value = S.current?.settings?.[p.key] ?? DEFAULT_SETTINGS[p.key];
    }

    input.addEventListener('change', () => {
      const v = input.value;
      S.current.settings[p.key] = p.type === 'number' ? (v === '' ? DEFAULT_SETTINGS[p.key] : Number(v)) : v;
      refreshDirty();
    });

    wrap.appendChild(label);
    wrap.appendChild(input);
    box.appendChild(wrap);
  }
}

/* ---------------- 渲染：当前角色表单 ---------------- */
function renderForm() {
  const p = S.current;
  if (!p) return;
  $('f-name').value = p.name || '';
  $('f-text-lang').value = p.text_lang || 'zh';
  $('f-speed').value = p.settings?.speed_factor ?? 1;
  $('f-gpt').value = p.models?.gpt || '';
  $('f-sovits').value = p.models?.sovits || '';
  $('f-root').value = S.root || '';
  $('f-root-current').textContent = S.root || '未设置';

  renderEmotionTabs();
  renderReference();
  renderAdvParams();
  refreshDirty();
}

/* ---------------- 读取表单到对象 ---------------- */
function collectForm() {
  const p = S.current;
  p.name = $('f-name').value.trim() || '未命名角色';
  p.text_lang = $('f-text-lang').value;
  p.settings = p.settings || { ...DEFAULT_SETTINGS };
  p.settings.speed_factor = Number($('f-speed').value || 1);
  p.models = {
    gpt: $('f-gpt').value.trim(),
    sovits: $('f-sovits').value.trim(),
  };
  syncReferenceFromForm();
  return p;
}

function effectiveModels() {
  return { gpt: $('f-gpt').value.trim(), sovits: $('f-sovits').value.trim() };
}

/* ---------------- 角色切换 ---------------- */
async function selectProfile(id) {
  if (S.current && id !== S.current.id && isDirty()) {
    if (!confirm('当前角色有未保存的修改，切换后会丢失。确定切换吗？')) return;
  }
  const p = S.profiles.find((x) => x.id === id);
  if (!p) return;
  S.current = clone(p);
  S.snapshot = JSON.stringify(S.current);
  S.emotion = 'neutral';
  renderRoleList();
  renderForm();
  setNotice($('model-notice'), '', '');
  setNotice($('tts-notice'), '', '');
}

function newRole() {
  if (S.current && isDirty()) {
    if (!confirm('当前角色有未保存的修改，新建后会丢失。确定继续吗？')) return;
  }
  S.current = blankProfile('新角色');
  S.snapshot = '';
  S.emotion = 'neutral';
  renderRoleList();
  renderForm();
  setNotice($('model-notice'), '', '');
}

/* ---------------- 状态栏 ---------------- */
async function checkHealth() {
  const gsEl = $('st-gs');
  const compEl = $('st-companion');
  compEl.className = 'dot ok';
  compEl.textContent = '已连接';
  $('st-apiurl').textContent = S.apiUrl || '—';

  try {
    const h = await api('/health');
    gsEl.className = 'dot ' + (h.connected ? 'ok' : 'err');
    gsEl.textContent = h.connected ? '已连接' : '未连接';
    $('dg-gs').textContent = h.connected ? '已连接' : '未连接';
    $('dg-title').textContent = h.description || '—';
    $('dg-paths').textContent = Array.isArray(h.schema) ? h.schema.join('  ') : '—';
    $('dg-companion').textContent = '已连接';
    if (!h.connected) {
      setNotice($('dg-notice'), 'warn', `${h.description}\n请先启动 GPT-SoVITS 的 api_v2.py（保证 http://127.0.0.1:9880/docs 可访问）。配置编辑与保存仍可使用。`);
    } else {
      setNotice($('dg-notice'), 'ok', `已连接：${h.description}`);
    }
  } catch (e) {
    gsEl.className = 'dot err';
    gsEl.textContent = '检测失败';
    setNotice($('dg-notice'), 'err', String(e.message || e));
  }
}

/* ---------------- 模型扫描 ---------------- */
async function refreshModels(silent) {
  try {
    const m = await api('/models');
    S.models = { gpt: m.gpt || [], sovits: m.sovits || [] };
    $('dg-gpt-count').textContent = String(S.models.gpt.length);
    $('dg-sov-count').textContent = String(S.models.sovits.length);
    $('dg-root').textContent = m.scanRoot ? `${m.root} → 实扫 ${m.scanRoot}` : m.root || '未设置';
    renderWeightsList($('dg-gpt-list'), S.models.gpt);
    renderWeightsList($('dg-sov-list'), S.models.sovits);
    fillModelPicker($('f-gpt-pick'), S.models.gpt);
    fillModelPicker($('f-sovits-pick'), S.models.sovits);
    if (!silent) {
      const total = S.models.gpt.length + S.models.sovits.length;
      const presets = S.models.gpt.filter((m) => m.preset).length + S.models.sovits.filter((m) => m.preset).length;
      // A corrected root must be stated, otherwise the numbers look like they came
      // from a directory the user never pointed at.
      const reroot = m.scanRoot ? `安装目录不是仓库根，已自动改用 ${m.scanRoot} 扫描。` : '';
      setNotice($('model-notice'), total ? 'ok' : 'warn',
        total
          ? `扫描完成：GPT ${S.models.gpt.length} 个，SoVITS ${S.models.sovits.length} 个（含底模 ${presets} 个）。${reroot}`
          : `未扫描到权重。${reroot}扫描规则：安装目录下「GPT 开头」的文件夹里找 .ckpt、「SoVITS 开头」的文件夹里找 .pth，只读文件夹第一层（另外单列 GPT_SoVITS/pretrained_models 里的官方底模）。请确认「安装目录」是 GPT-SoVITS 仓库根，或直接在下方的 GPT / SoVITS 输入框手动填写权重文件的绝对路径。`);
    }
  } catch (e) {
    if (!silent) setNotice($('model-notice'), 'err', String(e.message || e));
  }
}

function renderWeightsList(ul, items) {
  ul.textContent = '';
  if (!items.length) {
    const li = document.createElement('li');
    li.textContent = '（空）';
    ul.appendChild(li);
    return;
  }
  for (const it of items) {
    const li = document.createElement('li');
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = `[${it.version}] `;
    li.appendChild(tag);
    li.appendChild(document.createTextNode(it.path));
    ul.appendChild(li);
  }
}

/* ---------------- 试听 ---------------- */
async function generate() {
  if (S.busy) return;
  const text = $('f-test-text').value.trim();
  if (!text) { setNotice($('tts-notice'), 'err', '请输入测试文本'); return; }

  collectForm();
  S.busy = true;
  const btn = $('btn-generate');
  btn.disabled = true;
  btn.textContent = '生成中…';
  setNotice($('tts-notice'), '', '');
  $('stat-elapsed').textContent = '—';

  const t0 = performance.now();
  try {
    const res = await fetch(API + '/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: S.current, text, emotion: $('f-test-emotion').value }),
    });
    const ct = res.headers.get('content-type') || '';
    if (!res.ok || ct.includes('application/json')) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || j.detail || `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    if (S.lastAudioUrl) URL.revokeObjectURL(S.lastAudioUrl);
    S.lastAudioUrl = URL.createObjectURL(blob);

    const player = $('player');
    player.src = S.lastAudioUrl;
    const dl = $('btn-download');
    dl.hidden = false;
    dl.href = S.lastAudioUrl;
    dl.download = `${S.current.name}-${$('f-test-emotion').value}-${Date.now()}.wav`;

    const elapsed = Number(res.headers.get('X-Elapsed-Ms') || Math.round(performance.now() - t0));
    $('stat-elapsed').textContent = fmtMs(elapsed);
    $('stat-emotion').textContent = `${EMOTION_LABEL[res.headers.get('X-Used-Emotion')] || res.headers.get('X-Used-Emotion') || '—'}`;
    $('stat-gpt').textContent = decodeURIComponent(res.headers.get('X-Loaded-Gpt') || '') || '（沿用 9880 当前）';
    $('stat-sovits').textContent = decodeURIComponent(res.headers.get('X-Loaded-Sovits') || '') || '（沿用 9880 当前）';
    S.loaded = {
      gpt: decodeURIComponent(res.headers.get('X-Loaded-Gpt') || ''),
      sovits: decodeURIComponent(res.headers.get('X-Loaded-Sovits') || ''),
    };

    try { await player.play(); }
    catch (_) { setNotice($('tts-notice'), 'warn', '音频已生成成功，但浏览器拦截了自动播放，请点击播放器播放。'); }
  } catch (e) {
    setNotice($('tts-notice'), 'err', String(e.message || e));
  } finally {
    S.busy = false;
    btn.disabled = false;
    btn.textContent = '生成并试听';
  }
}

/* ---------------- 导入 / 导出 ---------------- */
function exportCurrent() {
  if (!S.current || !S.profiles.some((p) => p.id === S.current.id)) {
    alert('请先保存该角色，再进行导出。');
    return;
  }
  const a = document.createElement('a');
  a.href = `${API}/profiles/${encodeURIComponent(S.current.id)}/export`;
  a.download = `${S.current.name}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setNotice($('tts-notice'), 'ok', '已导出角色 JSON。文件内含本机绝对路径，分享前请确认是否需要删除。');
}

async function doImport(file) {
  try {
    const json = JSON.parse(await file.text());
    const r = await api('/profiles/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: json }),
    });
    await loadState(r.profile.id);
    setNotice($('model-notice'), 'warn',
      `已导入角色「${r.profile.name}」（新 ID，未覆盖已有角色）。\n如果是从其它电脑导入的配置，请检查权重与参考音频在本机的路径是否存在。`);
    await refreshModels(true);
  } catch (e) {
    alert(`导入失败：${e.message || e}`);
  }
}

/* ---------------- 加载全局状态 ---------------- */
async function loadState(focusId) {
  const st = await api('/state');
  S.root = st.root || '';
  S.profiles = st.profiles || [];
  S.apiUrl = st.apiUrl || '';
  S.loaded = st.loaded || { gpt: '', sovits: '' };
  $('f-root-current').textContent = S.root || '未设置';
  $('f-root').value = S.root || '';
  $('stat-gpt').textContent = S.loaded.gpt || '（沿用 9880 当前）';
  $('stat-sovits').textContent = S.loaded.sovits || '（沿用 9880 当前）';

  const target = focusId && S.profiles.find((p) => p.id === focusId) ? focusId : S.profiles[0]?.id;
  const p = S.profiles.find((x) => x.id === target);
  S.current = clone(p || blankProfile());
  S.snapshot = JSON.stringify(S.current);
  S.emotion = 'neutral';

  renderRoleList();
  renderForm();
}

/* ---------------- 事件绑定 ---------------- */
function bind() {
  // 导航
  for (const btn of document.querySelectorAll('.nav-item')) {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      for (const b of document.querySelectorAll('.nav-item')) b.classList.toggle('is-active', b === btn);
      $('view-studio').hidden = view !== 'studio';
      $('view-status').hidden = view !== 'status';
      $('view-title').textContent = view === 'studio' ? '语音工作室' : '9880 状态';
      if (view === 'status') { checkHealth(); refreshModels(true); }
    });
  }

  // 基本信息
  $('f-name').addEventListener('input', () => {
    S.current.name = $('f-name').value;
    refreshDirty();
  });
  $('f-text-lang').addEventListener('change', () => {
    S.current.text_lang = $('f-text-lang').value;
    refreshDirty();
  });
  $('f-speed').addEventListener('change', () => {
    S.current.settings.speed_factor = Number($('f-speed').value || 1);
    refreshDirty();
  });

  // 模型：输入框为主，下拉只做辅助快速填写
  for (const [inputId, pickId, key] of [['f-gpt', 'f-gpt-pick', 'gpt'], ['f-sovits', 'f-sovits-pick', 'sovits']]) {
    $(inputId).addEventListener('input', () => {
      if (S.current) S.current.models[key] = $(inputId).value.trim();
      refreshDirty();
    });
    $(pickId).addEventListener('change', () => {
      const v = $(pickId).value;
      if (!v) return;
      $(inputId).value = v;
      if (S.current) S.current.models[key] = v;
      $(pickId).value = ''; // 复位，方便下次再选同一个
      refreshDirty();
    });
  }

  // 刷新扫描：保存安装目录并立即重新扫描
  $('btn-scan-root').addEventListener('click', async () => {
    const root = $('f-root').value.trim();
    if (!root) { setNotice($('model-notice'), 'err', '请先填写安装目录'); return; }
    const btn = $('btn-scan-root');
    btn.disabled = true;
    btn.textContent = '扫描中…';
    try {
      const r = await api('/root', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root }),
      });
      S.root = r.root;
      $('f-root-current').textContent = r.root;
      await refreshModels(false);
      setNotice($('model-notice'), 'ok', `安装目录已保存并扫描：${r.root}`);
    } catch (e) {
      setNotice($('model-notice'), 'err', String(e.message || e));
    } finally {
      btn.disabled = false;
      btn.textContent = '刷新扫描';
    }
  });
  $('btn-apply-models').addEventListener('click', async () => {
    const m = effectiveModels();
    if (!m.gpt && !m.sovits) { setNotice($('model-notice'), 'warn', '两个权重都为空，将沿用 9880 当前模型。'); return; }
    $('btn-apply-models').disabled = true;
    try {
      const r = await api('/models/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(m),
      });
      S.loaded = r.loaded;
      $('stat-gpt').textContent = r.loaded.gpt || '（沿用 9880 当前）';
      $('stat-sovits').textContent = r.loaded.sovits || '（沿用 9880 当前）';
      setNotice($('model-notice'), 'ok', '权重已应用到 9880。');
    } catch (e) {
      setNotice($('model-notice'), 'err', e.detail ? `${e.message}\n${e.detail}` : String(e.message || e));
    } finally {
      $('btn-apply-models').disabled = false;
    }
  });

  // 情绪参考
  for (const id of ['f-ref-audio', 'f-ref-text', 'f-ref-lang']) {
    $(id).addEventListener('change', syncReferenceFromForm);
    $(id).addEventListener('input', () => { /* 延迟到 change 同步，避免频繁重渲染 */ });
  }
  $('btn-ref-play').addEventListener('click', async () => {
    const p = $('f-ref-audio').value.trim();
    if (!p) { setNotice($('model-notice'), 'err', '请先填写参考音频路径或上传音频'); return; }
    const audio = new Audio(`${API}/references/audio?path=${encodeURIComponent(p)}`);
    audio.play().catch(() => {
      setNotice($('model-notice'), 'warn', '无法播放：仅允许读取安装目录或工作台上传目录内的音频。如音频在其它位置，请通过「上传音频」导入。');
    });
  });
  $('f-ref-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const res = await fetch(API + '/references/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name) },
        body: buf,
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      $('f-ref-audio').value = j.path;
      syncReferenceFromForm();
      setNotice($('model-notice'), 'ok', `已上传：${j.path}`);
    } catch (err) {
      setNotice($('model-notice'), 'err', String(err.message || err));
    } finally {
      e.target.value = '';
    }
  });

  // 保存 / 删除 / 新增
  $('btn-save').addEventListener('click', async () => {
    collectForm();
    try {
      const r = await api('/profiles/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: S.current }),
      });
      S.current = clone(r.profile);
      S.snapshot = JSON.stringify(S.current);
      await loadState(r.profile.id);
      setNotice($('model-notice'), 'ok', `已保存角色「${r.profile.name}」。`);
    } catch (e) {
      setNotice($('model-notice'), 'err', String(e.message || e));
    }
  });

  $('btn-delete').addEventListener('click', async () => {
    if (!S.current) return;
    if (S.profiles.length <= 1) { setNotice($('model-notice'), 'err', '至少保留一个角色，最后一个角色不可删除。'); return; }
    if (!confirm(`确定删除角色「${S.current.name}」？该操作不可撤销。`)) return;
    try {
      await api(`${API}/profiles/${encodeURIComponent(S.current.id)}`, { method: 'DELETE' });
      await loadState();
      setNotice($('model-notice'), 'ok', '角色已删除。');
    } catch (e) {
      setNotice($('model-notice'), 'err', String(e.message || e));
    }
  });

  $('btn-new-role').addEventListener('click', newRole);

  // 试听
  $('btn-generate').addEventListener('click', generate);
  $('btn-recheck').addEventListener('click', () => { checkHealth(); refreshModels(true); });

  // 导入 / 导出
  $('btn-export').addEventListener('click', exportCurrent);
  $('btn-import').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (file) await doImport(file);
    e.target.value = '';
  });

  // 离开页面提示
  window.addEventListener('beforeunload', (e) => {
    if (isDirty()) { e.preventDefault(); e.returnValue = ''; }
  });
}

/* ---------------- 启动 ---------------- */
(async function main() {
  fillSelect($('f-text-lang'), LANGS, null);
  fillSelect($('f-ref-lang'), LANGS, null);
  fillSelect($('f-test-emotion'), EMOTIONS, null);
  for (const o of $('f-test-emotion').options) {
    if (o.value && !ENABLED_EMOTIONS.has(o.value)) o.disabled = true;
  }
  $('f-test-emotion').value = 'neutral';
  $('f-test-emotion').title = '本版仅支持「普通」情绪';
  bind();
  try {
    await loadState();
  } catch (e) {
    alert(`无法连接 Shiro 后端：${e.message || e}\n请确认应用后端正在运行（开发模式执行 npm run dev）。`);
    return;
  }
  await refreshModels(true);
  checkHealth();
  setInterval(checkHealth, 15000);
})();

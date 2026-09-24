import type { MicroDynamicsConfig } from './types.ts';

const EASINGS = new Set(['linear', 'easeIn', 'easeOut', 'easeInOut']);
const TIERS = new Set(['A', 'B', 'C']);

export function parseMicroDynamicsConfig(value: unknown): MicroDynamicsConfig {
  if (!isRecord(value) || value.version !== 1) throw new Error('version 必须为 1');
  if (!isRecord(value.model) || typeof value.model.url !== 'string') throw new Error('model.url 无效');
  if (!isRecord(value.model.camera)) throw new Error('model.camera 无效');
  assertTuple(value.model.camera.position, 'model.camera.position', 3);
  assertTuple(value.model.camera.lookAt, 'model.camera.lookAt', 3);
  assertNumber(value.model.camera.fov, 'model.camera.fov', 1);
  if (
    !isRecord(value.bindings) ||
    !isStringRecord(value.bindings.expressions) ||
    !isBoneBindingRecord(value.bindings.bones)
  ) {
    throw new Error('bindings 必须包含 expressions 字符串映射和 bones 骨骼映射');
  }
  if (
    value.bindings.morphs !== undefined &&
    (!isRecord(value.bindings.morphs) ||
      Object.values(value.bindings.morphs).some(
        (names) =>
          !Array.isArray(names) ||
          names.length === 0 ||
          names.some((name) => typeof name !== 'string' || !name.trim())
      ))
  )
    throw new Error('bindings.morphs 必须包含非空形变名称数组');
  if (
    !isRecord(value.scheduler) ||
    typeof value.scheduler.enabled !== 'boolean' ||
    !Array.isArray(value.scheduler.rules)
  ) {
    throw new Error('scheduler 无效');
  }
  if (!Array.isArray(value.states) || !Array.isArray(value.actions))
    throw new Error('states/actions 必须为数组');
  const actionIds = new Set<string>();
  for (const [index, raw] of value.actions.entries()) {
    if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id.trim())
      throw new Error(`actions[${index}].id 无效`);
    if (actionIds.has(raw.id)) throw new Error(`动作 ID 重复：${raw.id}`);
    actionIds.add(raw.id);
    if (typeof raw.label !== 'string' || typeof raw.description !== 'string')
      throw new Error(`${raw.id} 缺少文案`);
    if (!TIERS.has(String(raw.tier))) throw new Error(`${raw.id}.tier 无效`);
    assertNumber(raw.durationMs, `${raw.id}.durationMs`, 1);
    if (!EASINGS.has(String(raw.easing))) throw new Error(`${raw.id}.easing 无效`);
    if (!Array.isArray(raw.tracks) || raw.tracks.length === 0) throw new Error(`${raw.id}.tracks 不能为空`);
    for (const [trackIndex, track] of raw.tracks.entries()) {
      if (!isRecord(track) || typeof track.target !== 'string' || !Array.isArray(track.keyframes)) {
        throw new Error(`${raw.id}.tracks[${trackIndex}] 无效`);
      }
      let previous = -1;
      if (track.startFromCurrent !== undefined && typeof track.startFromCurrent !== 'boolean')
        throw new Error(`${raw.id}.${track.target}.startFromCurrent 必须为布尔值`);
      for (const frame of track.keyframes) {
        if (!isRecord(frame)) throw new Error(`${raw.id}.${track.target} 关键帧无效`);
        assertNumber(frame.at, `${raw.id}.${track.target}.at`, 0, 1);
        const isBoneTrack = Object.prototype.hasOwnProperty.call(value.bindings.bones, track.target);
        assertNumber(
          frame.value,
          `${raw.id}.${track.target}.value`,
          isBoneTrack ? -180 : -1,
          isBoneTrack ? 180 : 1
        );
        if (frame.at < previous) throw new Error(`${raw.id}.${track.target} 关键帧时间必须升序`);
        previous = frame.at;
      }
    }
  }
  for (const [index, rule] of value.scheduler.rules.entries()) {
    if (!isRecord(rule) || typeof rule.action !== 'string' || !actionIds.has(rule.action)) {
      throw new Error(`scheduler.rules[${index}].action 无效`);
    }
    assertTuple(rule.intervalMs, `scheduler.rules[${index}].intervalMs`, 2);
    if (rule.intervalMs[0] > rule.intervalMs[1]) throw new Error('scheduler intervalMs 必须升序');
    assertNumber(rule.probability, `scheduler.rules[${index}].probability`, 0, 1);
  }
  for (const [index, state] of value.states.entries()) {
    if (
      !isRecord(state) ||
      typeof state.id !== 'string' ||
      typeof state.label !== 'string' ||
      !isNumberRecord(state.values)
    ) {
      throw new Error(`states[${index}] 无效`);
    }
  }
  return value as unknown as MicroDynamicsConfig;
}

export function sampleTrack(
  track: { keyframes: Array<{ at: number; value: number }> },
  progress: number
): number {
  const frames = track.keyframes;
  if (frames.length === 0) return 0;
  if (progress <= frames[0].at) return frames[0].value;
  for (let index = 1; index < frames.length; index += 1) {
    const next = frames[index];
    const previous = frames[index - 1];
    if (progress <= next.at) {
      const span = next.at - previous.at;
      const ratio = span <= 0 ? 1 : (progress - previous.at) / span;
      return previous.value + (next.value - previous.value) * ratio;
    }
  }
  return frames[frames.length - 1].value;
}

function assertNumber(
  value: unknown,
  label: string,
  min: number,
  max = Number.POSITIVE_INFINITY
): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} 必须是 ${min}..${max} 的数字`);
  }
}

function assertTuple(value: unknown, label: string, size: number): asserts value is number[] {
  if (
    !Array.isArray(value) ||
    value.length !== size ||
    value.some((item) => typeof item !== 'number' || !Number.isFinite(item))
  ) {
    throw new Error(`${label} 必须包含 ${size} 个数字`);
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === 'string');
}

function isNumberRecord(value: unknown): value is Record<string, number> {
  return (
    isRecord(value) && Object.values(value).every((item) => typeof item === 'number' && Number.isFinite(item))
  );
}

function isBoneBindingRecord(value: unknown): boolean {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (item) =>
        isRecord(item) &&
        typeof item.node === 'string' &&
        (item.axis === 'x' || item.axis === 'y' || item.axis === 'z')
    )
  );
}

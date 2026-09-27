/**
 * 自由投射模式下「这一下按的是哪个角色」的判定。
 *
 * 每个角色是 `left = pose.x%`、宽 `area.width / count`、高 100% 的一整列
 * （`.desktop-cast-actor`，见 desktop-pet.css）。列只在初始布局里刚好铺满，
 * 一旦被拖到邻居身上就互相重叠，而按下时又会被提到最上层（`z = max + 1`）——
 * 于是「鼠标停在 B 身上、事件却落在 A 的列里」成了常态。只认事件目标，
 * 就会把上一次拖过的角色再拖一次。
 *
 * 所以判定跟 `hitTest`（右键菜单、窗口穿透）保持一致：从 DOM 栈顶往下，
 * 取第一个**模型轮廓**覆盖该点的角色；只有没有任何模型覆盖该点时才退回被按下的列
 * （点空白处、模型还没加载完，都走这条兜底）。
 */

/** DOM 栈里所有角色 id，栈顶在前、已去重。 */
export function actorIdsFromStack(stack: readonly Element[]): string[] {
  const ids: string[] = [];
  for (const element of stack) {
    const id = element.closest<HTMLElement>('.desktop-cast-actor')?.dataset.characterId;
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * @param stackIds 该点下的角色 id，栈顶在前（`actorIdsFromStack` 的输出）
 * @param coversPoint 该角色的模型轮廓是否盖住该点
 * @param pressedId 事件实际落到的列所属角色；没人盖住该点时的兜底，传 `null` 表示
 *   调用方只关心「鼠标下有没有模型」
 */
export function resolveDragTargetId(
  stackIds: readonly string[],
  coversPoint: (id: string) => boolean,
  pressedId: string | null
): string | null {
  for (const id of stackIds) {
    if (coversPoint(id)) return id;
  }
  return pressedId;
}

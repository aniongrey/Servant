import { describe, expect, it } from 'vitest';
import { actorIdsFromStack, resolveDragTargetId } from './desktopCastDrag';

/** 元素命中栈里的一个节点：`undefined` = 不属于任何角色的节点（画布、容器…）。 */
function node(characterId?: string): Element {
  return { closest: () => (characterId ? { dataset: { characterId } } : null) } as unknown as Element;
}

describe('cast drag target', () => {
  it('drags the pet under the cursor, not the column that received the press', () => {
    // 这是用户报的那个 bug：上一次拖过的 a 被提到最上层，列盖住了 b 的身体，
    // 事件落在 a 的列里，但鼠标下面是 b 的模型 —— 应该拖 b。
    expect(resolveDragTargetId(['a', 'b'], (id) => id === 'b', 'a')).toBe('b');
  });

  it('keeps the topmost model when two silhouettes overlap', () => {
    expect(resolveDragTargetId(['a', 'b'], () => true, 'b')).toBe('a');
  });

  it('falls back to the pressed column when the point hits no model', () => {
    expect(resolveDragTargetId(['a', 'b'], () => false, 'a')).toBe('a');
  });

  it('falls back while the models are still loading', () => {
    expect(resolveDragTargetId([], () => false, 'b')).toBe('b');
  });

  it('reports no target when the point is empty and no column was pressed', () => {
    expect(resolveDragTargetId(['a'], () => false, null)).toBeNull();
  });
});

describe('actor ids from the hit stack', () => {
  it('keeps stack order and drops duplicates from ancestor nodes', () => {
    const stack = [node('a'), node(), node('b'), node('a'), node('b')];
    expect(actorIdsFromStack(stack)).toEqual(['a', 'b']);
  });

  it('is empty when nothing under the point belongs to a cast actor', () => {
    expect(actorIdsFromStack([node(), node()])).toEqual([]);
  });
});

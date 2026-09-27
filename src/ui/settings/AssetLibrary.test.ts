import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AssetFieldEditor, AssetLibrary, type AssetLibraryItem } from './AssetLibrary';

const items: AssetLibraryItem[] = [
  { id: 'builtin', name: '白瓜', meta: '内置', active: true, removable: false, keywords: 'TestModel' },
  { id: 'imported', name: '可莉', meta: '导入 · 12 MB · 原名 keli', renamed: true, icon: null }
];

function render(overrides: Partial<Parameters<typeof AssetLibrary>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(AssetLibrary, {
      heading: '模型库',
      summary: '内置 1 · 导入 1',
      emptyText: '暂无模型',
      searchPlaceholder: '搜索模型',
      items,
      onSelect: () => undefined,
      ...overrides
    })
  );
}

describe('AssetLibrary', () => {
  it('lists every row with its secondary line and marks the active one', () => {
    const markup = render();
    expect(markup).toContain('模型库');
    expect(markup).toContain('内置 1 · 导入 1');
    expect(markup).toContain('白瓜');
    expect(markup).toContain('可莉');
    expect(markup).toContain('导入 · 12 MB · 原名 keli');
    expect(markup).toContain('data-active="true"');
    expect(markup).toContain('aria-label="搜索模型"');
  });

  it('offers no row actions until the caller asks for them', () => {
    const markup = render();
    expect(markup).not.toContain('重命名');
    expect(markup).not.toContain('删除');
    expect(markup).not.toContain('恢复');
  });

  it('shows rename, reset and delete per row capabilities', () => {
    const markup = render({
      editorFields: () => [{ key: 'name', label: '模型名称', value: '白瓜' }],
      onEdit: () => undefined,
      onResetName: () => undefined,
      onDelete: () => undefined
    });
    // Rename and delete are offered on both rows...
    expect(markup).toContain('aria-label="重命名 白瓜"');
    expect(markup).toContain('aria-label="重命名 可莉"');
    // ...but only the imported one can be deleted, and only the renamed one reset.
    expect(markup).toContain('aria-label="删除 可莉"');
    expect(markup).not.toContain('aria-label="删除 白瓜"');
    expect(markup).toContain('aria-label="恢复 可莉 的原名"');
    expect(markup).not.toContain('aria-label="恢复 白瓜 的原名"');
  });

  it('keeps the search box out of an empty library', () => {
    const markup = render({ items: [] });
    expect(markup).toContain('暂无模型');
    expect(markup).not.toContain('搜索模型');
  });
});

describe('AssetFieldEditor', () => {
  it('seeds a field per key and blocks saving while one is blank', () => {
    const filled = renderToStaticMarkup(
      createElement(AssetFieldEditor, {
        fields: [
          { key: 'name', label: '名称', value: '白瓜' },
          { key: 'voice', label: '音色 ID', value: 'alloy' }
        ],
        onSave: () => undefined,
        onCancel: () => undefined
      })
    );
    expect(filled).toContain('名称');
    expect(filled).toContain('音色 ID');
    expect(filled).toContain('value="白瓜"');
    expect(filled).not.toContain('disabled');

    const incomplete = renderToStaticMarkup(
      createElement(AssetFieldEditor, {
        fields: [{ key: 'voice', label: '音色 ID', value: '   ' }],
        onSave: () => undefined,
        onCancel: () => undefined
      })
    );
    expect(incomplete).toContain('disabled');
  });

  it('renders a field that carries options as a picker, seeded at its current value', () => {
    const markup = renderToStaticMarkup(
      createElement(AssetFieldEditor, {
        fields: [
          { key: 'name', label: '名称', value: '白瓜' },
          {
            key: 'voice',
            label: '角色（音色）',
            value: 'prof-1',
            options: [
              { id: 'prof-1', label: '白瓜声线' },
              { id: 'prof-2', label: '可莉声线' }
            ]
          }
        ],
        onSave: () => undefined,
        onCancel: () => undefined
      })
    );
    // Only the free-text field stays an input.
    expect((markup.match(/<input/g) ?? []).length).toBe(1);
    expect(markup).toContain('<select');
    expect(markup).toContain('白瓜声线');
    expect(markup).toContain('可莉声线');
    // The field's value is the selected option, so saving cannot switch roles.
    expect(markup).toContain('selected');
  });

  it('offers suggestions as autocomplete on a field that stays free text', () => {
    const markup = renderToStaticMarkup(
      createElement(AssetFieldEditor, {
        fields: [
          {
            key: 'voice',
            label: '音色',
            value: 'voice-abc',
            suggestions: [
              { id: 'alloy', label: 'alloy' },
              { id: 'nova', label: 'nova' }
            ]
          }
        ],
        onSave: () => undefined,
        onCancel: () => undefined
      })
    );
    // A `datalist` only suggests: the id the user already has must stay usable.
    expect(markup).toContain('<input');
    expect(markup).not.toContain('<select');
    expect(markup).toContain('value="voice-abc"');
    expect(markup).toMatch(/<input[^>]*list="[^"]+"/);
    const listId = /<input[^>]*list="([^"]+)"/.exec(markup)?.[1];
    expect(listId).toBeTruthy();
    expect(markup).toContain(`<datalist id="${listId}"`);
    expect(markup).toContain('nova');
  });
});

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button, Dialog, SelectInput, TextAreaInput, TextInput } from './ServantControls';

describe('shared meeting/settings controls', () => {
  it('gives both pages the same field, button, and dialog primitives', () => {
    const markup = renderToStaticMarkup(createElement(Dialog, {
      title: '重命名', onClose: () => undefined, actions: createElement(Button, { variant: 'primary' }, '保存'),
      children: [createElement(TextInput, { key: 'name', placeholder: '名称' }),
        createElement(SelectInput, { key: 'role', children: createElement('option', null, '角色') }),
        createElement(TextAreaInput, { key: 'note' })]
    }));
    expect(markup).toContain('class="servant-dialog"');
    expect(markup).toContain('class="servant-field"');
    expect(markup).toContain('class="servant-field servant-select"');
    expect(markup).toContain('servant-button--primary');
  });
});

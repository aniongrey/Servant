import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ControlGroup } from './SettingsControls';

describe('ControlGroup', () => {
  it('marks a disabled parent as collapsed while keeping its switch available', () => {
    const markup = renderToStaticMarkup(
      createElement(ControlGroup, {
        title: 'Outline',
        enabled: false,
        onEnabledChange: () => undefined,
        children: createElement('span', null, 'Line Dark')
      })
    );

    expect(markup).toContain('data-collapsed="true"');
    expect(markup).toContain('aria-checked="false"');
    expect(markup).toContain('Line Dark');
  });
});

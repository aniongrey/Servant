import { useState } from 'react';

import actionConfigs from '../../character/motion/assets/actions/action-configs.json';
import { vrmaManualTestMotions } from '../../character/motion/assets/vrmaTestMotions';
import { PanelTitle } from './SettingsControls';
import { Search, CircleDot } from 'lucide-react';
import { humanize } from './settingsState';

export function ActionSettings() {
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();
  const visibleMotions = vrmaManualTestMotions.filter((motion) =>
    motion.id.toLowerCase().includes(normalizedQuery)
  );
  return (
    <div className="aurelia-actions-layout">
      <section className="aurelia-panel aurelia-actions-summary">
        <PanelTitle title="动作索引" eyebrow="LIBRARY" />
        <div className="aurelia-library-count">
          <strong>{vrmaManualTestMotions.length}</strong>
          <span>VRMA ASSETS</span>
        </div>
        <div className="aurelia-library-count">
          <strong>{actionConfigs.length}</strong>
          <span>SEMANTIC ACTIONS</span>
        </div>
        <label className="aurelia-action-search">
          <Search size={14} />
          <input
            aria-label="搜索动作"
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="搜索动作"
            value={query}
          />
        </label>
      </section>
      <section className="aurelia-panel aurelia-motion-browser">
        <PanelTitle title="VRMA 资源" eyebrow="ALL ASSETS" />
        <div className="aurelia-motion-grid">
          {visibleMotions.map((motion, index) => (
            <article key={motion.id} className="aurelia-action-card">
              <div className="aurelia-action-index">{String(index + 1).padStart(2, '0')}</div>
              <div>
                <strong>{humanize(motion.id.replace('vrma_test_', ''))}</strong>
                <span>{motion.id}</span>
              </div>
              <CircleDot size={15} />
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

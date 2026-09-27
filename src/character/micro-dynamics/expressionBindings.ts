import * as THREE from 'three';
import { VRMExpression, VRMExpressionMorphTargetBind, type VRM } from '@pixiv/three-vrm';
import type { MicroDynamicsConfig } from './types';

export function bindMicroDynamicsExpressions(vrm: VRM, config: MicroDynamicsConfig) {
  const bindings = new Map(Object.entries(config.bindings.expressions));
  const created: VRMExpression[] = [];
  const manager = vrm.expressionManager;
  if (manager)
    for (const [logical, candidates] of Object.entries(config.bindings.morphs ?? {})) {
      // Each candidate is one shape or an explicit group (e.g. both mouth corners).
      const group = config.bindings.morphGroups?.[logical];
      for (const candidate of group ? [group, ...candidates] : candidates) {
        const names = typeof candidate === 'string' ? [candidate] : candidate;
        const found = new Set<string>();
        const expression = new VRMExpression(`microDynamics:${logical}`);
        vrm.scene.traverse((object) => {
          if (!(object instanceof THREE.Mesh) || !object.morphTargetInfluences) return;
          for (const candidateName of names) {
            const entry = Object.entries(object.morphTargetDictionary ?? {}).find(
              ([name]) => name === candidateName || name.endsWith(`.${candidateName}`)
            );
            if (entry) {
              found.add(candidateName);
              expression.addBind(
                new VRMExpressionMorphTargetBind({
                  primitives: [object],
                  index: entry[1],
                  weight: 1
                })
              );
            }
          }
        });
        if (found.size !== names.length) continue;
        manager.registerExpression(expression);
        created.push(expression);
        bindings.set(logical, expression.expressionName);
        break;
      }
    }
  return { bindings, created };
}

import * as THREE from 'three';
import { VRMExpression, VRMExpressionMorphTargetBind, type VRM } from '@pixiv/three-vrm';
import type { MicroDynamicsConfig } from './types';

export function bindMicroDynamicsExpressions(vrm: VRM, config: MicroDynamicsConfig) {
  const bindings = new Map(Object.entries(config.bindings.expressions));
  const created: VRMExpression[] = [];
  const manager = vrm.expressionManager;
  if (manager)
    for (const [logical, candidates] of Object.entries(config.bindings.morphs ?? {})) {
      // Use the first supported shape across all primitives, without combining alternative shapes.
      for (const candidate of candidates) {
        const expression = new VRMExpression(`microDynamics:${logical}`);
        vrm.scene.traverse((object) => {
          if (!(object instanceof THREE.Mesh) || !object.morphTargetInfluences) return;
          const entry = Object.entries(object.morphTargetDictionary ?? {}).find(
            ([name]) => name === candidate || name.endsWith(`.${candidate}`)
          );
          if (entry)
            expression.addBind(
              new VRMExpressionMorphTargetBind({
                primitives: [object],
                index: entry[1],
                weight: 1
              })
            );
        });
        if (expression.binds.length === 0) continue;
        manager.registerExpression(expression);
        created.push(expression);
        bindings.set(logical, expression.expressionName);
        break;
      }
    }
  return { bindings, created };
}

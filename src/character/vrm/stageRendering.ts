import { type CSSProperties } from 'react';
import * as THREE from 'three';
import type { VisemeWeights } from 'three-vrm-lip-sync';
import { type CharacterRenderConfig, defaultCharacterRenderConfig } from './CharacterRenderConfig';
import { clampCameraZoom } from './cameraZoom';
import { VrmModelLoader } from './VrmModelLoader';

export function getVrmFrontRotationY(vrm: Awaited<ReturnType<VrmModelLoader['load']>>): number {
  return vrm.meta.metaVersion === '0' ? Math.PI : 0;
}

export function applyViewRotation(root: THREE.Object3D, baseRotationY: number, viewRotationY: number): void {
  root.rotation.y = baseRotationY + viewRotationY;
}

export function applyWheelZoom(
  camera: THREE.PerspectiveCamera,
  deltaY: number,
  deltaMode: number,
  height: number,
  anchorY?: number
): void {
  const previousZoom = camera.zoom;
  const previousCameraY = camera.position.y;
  const delta = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? height : 1);
  camera.zoom = clampCameraZoom(camera.zoom * Math.exp(-delta * 0.001));
  if (anchorY !== undefined) {
    camera.position.y = anchorY + (previousCameraY - anchorY) * (previousZoom / camera.zoom);
    camera.lookAt(0, camera.position.y, 0);
  }
  camera.updateProjectionMatrix();
}

export function setCameraZoomKeepingFootPosition(
  camera: THREE.PerspectiveCamera,
  zoom: number,
  centerY: number,
  footY = 0
): void {
  camera.zoom = clampCameraZoom(zoom);
  camera.position.y = footY + (centerY - footY) / camera.zoom;
  camera.lookAt(0, camera.position.y, 0);
  camera.updateProjectionMatrix();
}

export function resizeRenderer(
  renderer: THREE.WebGLRenderer,
  camera: THREE.PerspectiveCamera,
  canvas: HTMLCanvasElement
): void {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));

  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

export function getCanvasStyle(config: CharacterRenderConfig): CSSProperties {
  if (!config.backShadowEnabled || config.backShadowOpacity <= 0) {
    return {};
  }

  const opacity = Math.min(1, Math.max(0, config.backShadowOpacity));
  return {
    filter: `drop-shadow(${config.backShadowOffsetX}px ${config.backShadowOffsetY}px ${config.backShadowBlur}px rgba(31, 34, 48, ${opacity}))`
  };
}

export function createContactShadow(
  scene: THREE.Scene
): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  const texture = new THREE.TextureLoader().load('/assets/fx/contact-shadow.png');
  texture.colorSpace = THREE.SRGBColorSpace;

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: defaultCharacterRenderConfig.contactShadowOpacity,
    depthWrite: false
  });

  const contactShadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  contactShadow.name = 'Character Contact Shadow';
  contactShadow.rotation.x = -Math.PI / 2;
  contactShadow.position.y = 0.005;
  contactShadow.renderOrder = -1;
  scene.add(contactShadow);

  return contactShadow;
}

export function createHairHighlightTexture(): THREE.Texture {
  const texture = new THREE.TextureLoader().load('/assets/fx/hair-highlight-matcap.png');
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

export function createMToonAoTexture(): THREE.Texture {
  const texture = new THREE.TextureLoader().load('/assets/fx/mtoon-ao-mask.png');
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

export function updateContactShadow(
  vrm: Awaited<ReturnType<VrmModelLoader['load']>> | null,
  contactShadow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null,
  config: CharacterRenderConfig
): void {
  if (!vrm || !contactShadow) {
    return;
  }

  contactShadow.visible = config.contactShadowEnabled && config.contactShadowOpacity > 0;
  if (!contactShadow.visible) {
    return;
  }

  const footCenter = getFootCenter(vrm);
  const height = Math.max(0, footCenter.y);
  const fade = Math.max(0, config.contactShadowHeightFade);
  const heightOpacity = THREE.MathUtils.clamp(
    config.contactShadowOpacity - height * fade,
    0,
    config.contactShadowOpacity
  );
  const heightScale = 1 + height * 0.5;

  contactShadow.position.set(footCenter.x, 0.005, footCenter.z);
  contactShadow.scale.set(
    config.contactShadowWidth * heightScale,
    config.contactShadowDepth * heightScale,
    1
  );
  contactShadow.material.opacity = heightOpacity;
}

function getFootCenter(vrm: Awaited<ReturnType<VrmModelLoader['load']>>): THREE.Vector3 {
  const leftFoot = vrm.humanoid.getNormalizedBoneNode('leftFoot');
  const rightFoot = vrm.humanoid.getNormalizedBoneNode('rightFoot');
  const leftPosition = leftFoot ? new THREE.Vector3().setFromMatrixPosition(leftFoot.matrixWorld) : null;
  const rightPosition = rightFoot ? new THREE.Vector3().setFromMatrixPosition(rightFoot.matrixWorld) : null;

  if (leftPosition && rightPosition) {
    return leftPosition.add(rightPosition).multiplyScalar(0.5);
  }

  return leftPosition ?? rightPosition ?? vrm.scene.position.clone();
}

export function updateHeadOverlayPosition(
  vrm: Awaited<ReturnType<VrmModelLoader['load']>> | null,
  camera: THREE.Camera,
  bubble: HTMLDivElement | null,
  headOffsetY = 0.14
): void {
  if (!vrm || !bubble) return;
  const head = vrm.humanoid.getNormalizedBoneNode('head');
  if (!head) return;

  const headPosition = head.localToWorld(new THREE.Vector3(0, headOffsetY, 0));
  headPosition.project(camera);
  const left = (headPosition.x * 0.5 + 0.5) * 100;
  const top = (-headPosition.y * 0.5 + 0.5) * 100;
  bubble.style.left = `${left}%`;
  bubble.style.top = `${top}%`;
  bubble.style.visibility = headPosition.z < -1 || headPosition.z > 1 ? 'hidden' : '';
}

/**
 * VRM expression preset names for visemes. Deliberately spelled out instead of
 * importing `VISEME_NAMES` from the analyser's library, and deliberately not
 * derived from anything else: that library declares `class extends
 * AudioWorkletNode` at module scope, so a value import here would throw in every
 * page this module is loaded into. Types from it stay `import type`.
 */
const VISEME_EXPRESSION_IDS = ['aa', 'ih', 'ou', 'ee', 'oh'] as const;

/**
 * Drives the mouth.
 *
 * With weights the mouth follows the spoken audio: the analyser
 * (`ai/tts/lipSync/visemeAnalyzer.ts`) classifies vowels in real time, so the
 * shape carries through vowels instead of only opening and closing. All five
 * visemes are written every frame — including the zeros — because a leftover
 * `ou` from an unfinished line would otherwise stay on the face until the next
 * line, and no other controller owns these expressions.
 *
 * Without weights — no analyser (browser speech synthesis, a window whose audio
 * context is still suspended, unsupported audio), or a head pat playing local
 * effects — it falls back to the procedural mouth hinged on `speaking`, which is
 * also what has to zero the visemes the analyser left behind.
 */
export function updateLipSync(
  vrm: Awaited<ReturnType<VrmModelLoader['load']>> | null,
  speaking: boolean,
  timeSeconds: number,
  visemeWeights: VisemeWeights | null = null
): void {
  const manager = vrm?.expressionManager;
  if (!manager) return;

  for (const viseme of VISEME_EXPRESSION_IDS) {
    // Models routinely ship only some of the five visemes; `setValue` on a
    // missing one is a no-op that warns.
    if (!manager.getExpression(viseme)) continue;
    const weight = visemeWeights
      ? visemeWeights[viseme]
      : viseme === 'aa' && speaking
      ? proceduralMouthWeight(timeSeconds)
      : 0;
    manager.setValue(viseme, Math.min(1, Math.max(0, weight)));
  }
}

/** Keep the mouth movement readable instead of fluttering at the old 13 rad/s rate. */
function proceduralMouthWeight(timeSeconds: number): number {
  return 0.25 + Math.abs(Math.sin(timeSeconds * 6.5)) * 0.55;
}

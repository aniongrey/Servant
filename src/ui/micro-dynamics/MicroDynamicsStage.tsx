import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { VrmModelLoader } from '../../character/vrm/VrmModelLoader';
import {
  applyRenderConfig,
  defaultCharacterRenderConfig,
  setupCharacterLighting,
  setupMToonMaterials
} from '../../character/vrm/CharacterRenderConfig';
import {
  applyViewRotation,
  createHairHighlightTexture,
  createMToonAoTexture,
  getVrmFrontRotationY,
  resizeRenderer
} from '../../character/vrm/stageRendering';
import { MicroDynamicsRuntime } from '../../character/micro-dynamics/MicroDynamicsRuntime';
import type { MicroDynamicsConfig } from '../../character/micro-dynamics/types';
import { ExpressionController } from '../../character/expression/ExpressionController';
import { VrmExpressionPlaybackAdapter } from '../../character/expression/VrmExpressionPlaybackAdapter';
import { RuntimeStore } from '../../app/state/RuntimeStore';

interface MicroDynamicsStageProps {
  config: MicroDynamicsConfig;
  expression?: string;
  onReady(runtime: MicroDynamicsRuntime | null): void;
  onStatus(message: string): void;
}

export function MicroDynamicsStage({ config, expression = 'neutral', onReady, onStatus }: MicroDynamicsStageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const runtimeRef = useRef<MicroDynamicsRuntime | null>(null);
  const expressionRef = useRef(expression);
  expressionRef.current = expression;
  const cameraSignature = JSON.stringify(config.model.camera);

  useEffect(() => {
    runtimeRef.current?.setConfig(config);
  }, [config]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let frame = 0;
    let previous = performance.now();
    const abortController = new AbortController();
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(config.model.camera.fov, 1, 0.1, 20);
    const cameraTarget = new THREE.Vector3().fromArray(config.model.camera.lookAt);
    const cameraOrbit = new THREE.Spherical().setFromVector3(
      new THREE.Vector3().fromArray(config.model.camera.position).sub(cameraTarget)
    );
    const updateCamera = () => {
      camera.position.copy(new THREE.Vector3().setFromSpherical(cameraOrbit).add(cameraTarget));
      camera.lookAt(cameraTarget);
    };
    updateCamera();
    const context = canvas.getContext('webgl2', { alpha: true, antialias: true });
    if (!context) {
      onStatus('浏览器无法创建 WebGL2 上下文');
      return;
    }
    const renderer = new THREE.WebGLRenderer({
      canvas,
      context: context as unknown as WebGLRenderingContext,
      alpha: true,
      antialias: true
    });
    renderer.setClearColor(0x000000, 0);
    const observer = new ResizeObserver(() => resizeRenderer(renderer, camera, canvas));
    observer.observe(canvas);
    resizeRenderer(renderer, camera, canvas);
    const lighting = setupCharacterLighting(scene);
    const hairTexture = createHairHighlightTexture();
    const aoTexture = createMToonAoTexture();
    let drag: { pointerId: number; x: number; y: number } | null = null;
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      cameraOrbit.theta -= (event.clientX - drag.x) * 0.008;
      cameraOrbit.phi = THREE.MathUtils.clamp(
        cameraOrbit.phi - (event.clientY - drag.y) * 0.008,
        0.12,
        Math.PI - 0.12
      );
      drag.x = event.clientX;
      drag.y = event.clientY;
      updateCamera();
      event.preventDefault();
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      drag = null;
    };
    const onWheel = (event: WheelEvent) => {
      cameraOrbit.radius = THREE.MathUtils.clamp(
        cameraOrbit.radius * Math.exp(event.deltaY * 0.001),
        0.55,
        7
      );
      updateCamera();
      event.preventDefault();
    };
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    onReady(null);
    onStatus(`正在加载 ${config.model.url}`);

    void new VrmModelLoader({ optimizeMesh: false })
      .load(config.model.url, abortController.signal)
      .then((vrm) => {
        if (disposed) return;
        applyViewRotation(vrm.scene, getVrmFrontRotationY(vrm), 0);
        scene.add(vrm.scene);
        const materials = setupMToonMaterials(vrm);
        applyRenderConfig(materials, lighting, defaultCharacterRenderConfig, hairTexture, aoTexture);
        const runtime = new MicroDynamicsRuntime(vrm, config, true);
        const face = new ExpressionController(new RuntimeStore(), new VrmExpressionPlaybackAdapter(vrm));
        runtimeRef.current = runtime;
        onReady(runtime);
        onStatus(`已加载 ${config.model.url}`);
        const loop = () => {
          const now = performance.now();
          const delta = Math.min(0.05, (now - previous) / 1000);
          previous = now;
          void face.set(expressionRef.current, 1);
          runtime.update(delta);
          vrm.update(delta);
          renderer.render(scene, camera);
          frame = requestAnimationFrame(loop);
        };
        loop();
      })
      .catch((error: unknown) => {
        if (!disposed) onStatus(error instanceof Error ? error.message : String(error));
      });

    return () => {
      disposed = true;
      abortController.abort();
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      runtimeRef.current?.dispose();
      runtimeRef.current = null;
      onReady(null);
      renderer.dispose();
      hairTexture.dispose();
      aoTexture.dispose();
    };
  }, [config.model.url, cameraSignature, onReady, onStatus]);

  return <canvas ref={canvasRef} className="micro-dynamics-canvas" />;
}

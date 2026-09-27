import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import characterConfig from './assets/default-character.json';
import { createCharacterController, type CharacterController } from '../CharacterController';
import {
  applyRenderConfig,
  type CharacterLighting,
  type CharacterMaterialSetup,
  type CharacterRenderConfig,
  defaultCharacterRenderConfig,
  setupCharacterLighting,
  setupMToonMaterials
} from './CharacterRenderConfig';
import { AvatarFitGuide } from '../ik/AvatarFitGuide';
import { type AvatarFitConfig } from '../ik/AvatarFitConfig';
import { VrmModelLoader, disposeCharacterModel } from './VrmModelLoader';
import { type TtsProvider } from '../../ai/tts/types';
import {
  prepareVisemeAnalyzer,
  readLiveVisemeWeights,
  unlockVisemeAnalyzer
} from '../../ai/tts/lipSync/visemeAnalyzer';
import { type SoulManager } from '../../soul';
import { createVrmHitTest, type ModelHitTest } from './modelHitTest';
import { useRemoteSpeechBubble } from './useRemoteSpeechBubble';
import { SpeechBubbleTimeline, type SpeechBubbleState } from './speechBubble';
import { cancelHeadFeedback, animateHeadFeedback } from './headTouchFeedback';
import {
  createCharacterProportionRig,
  defaultCharacterProportionConfig,
  type CharacterProportionConfig
} from './CharacterProportion';
import { createHeadTouchFeedback, ENTRY_HEAD_TOUCH_SOUND_URL } from './headTouchAudio';
import {
  resizeRenderer,
  afterFirstStageRender,
  createHairHighlightTexture,
  createMToonAoTexture,
  getVrmFrontRotationY,
  applyViewRotation,
  applyWheelZoom,
  createContactShadow,
  updateHeadOverlayPosition,
  updateLipSync,
  updateContactShadow,
  getCanvasStyle,
  setCameraZoomKeepingFootPosition
} from './stageRendering';
import { clampCameraZoom, DEFAULT_CAMERA_ZOOM } from './cameraZoom';
import { fitStageCamera } from './stageRendering';
import { createEmissiveDissolveEffect } from './EmissiveDissolveEffect';
import type { SharedStageRenderer } from './SharedStageRenderer';

// Extra lift measured in head heights: 0.5 raises the basin by half a head.
const PROTECTION_HEAD_HEIGHT_OFFSET = 0.5;

interface VrmStageProps {
  characterId?: string;
  acceptsUntargetedSpeech?: boolean;
  modelUrl: string;
  avatarFitConfig: AvatarFitConfig;
  holdMicroMotionEnabled: boolean;
  footIkEnabled: boolean;
  ttsProvider?: TtsProvider;
  /**
   * Whether the speech bubble is rendered at all. Timing still runs, so turning
   * the hints back on mid-sentence shows the line that is actually playing.
   */
  speechBubbleEnabled?: boolean;
  characterStateManager?: SoulManager;
  renderConfig?: CharacterRenderConfig;
  proportionConfig?: CharacterProportionConfig;
  onHitTestReady?(hitTest: ModelHitTest | null): void;
  onModelDrag?(): void;
  /** Disable canvas rotation when the owner handles character movement. */
  rotationEnabled?: boolean;
  /**
   * Wheel zoom the camera starts at, and restarts from whenever the stage is
   * rebuilt for a new model. The wheel keeps working from there; whether the
   * result is worth remembering is the owner's decision, which is why nothing
   * here touches storage.
   */
  initialZoom?: number;
  /** Owner-driven framing, independent of whether wheel interaction is enabled. */
  controlledZoom?: number;
  /** Disable wheel zoom for stages whose owner applies a fixed character framing. */
  wheelZoomEnabled?: boolean;
  /** Keep this world-space height fixed on screen during wheel zoom. */
  wheelZoomAnchorY?: number;
  /** Shift the camera's framing center vertically while keeping its viewing direction. */
  viewCenterOffsetY?: number;
  /** Optional material-level reveal used by short-lived presentation effects. */
  dissolveProgress?: number;
  /** Projected top and bottom of the loaded model, as viewport percentages. */
  onCharacterProjection?(bounds: { footY: number; headY: number }): void;
  /** Fires after each wheel zoom with the new camera zoom. */
  onZoomChange?(zoom: number): void;
  onEngineReady(engine: CharacterController): void;
  onStatus(message: string): void;
  sharedStageRenderer?: SharedStageRenderer;
}

export function VrmStage({
  characterId,
  acceptsUntargetedSpeech = true,
  modelUrl,
  avatarFitConfig,
  holdMicroMotionEnabled,
  footIkEnabled,
  ttsProvider,
  speechBubbleEnabled = true,
  characterStateManager,
  renderConfig = defaultCharacterRenderConfig,
  proportionConfig = defaultCharacterProportionConfig,
  onHitTestReady,
  onModelDrag,
  rotationEnabled = true,
  initialZoom,
  controlledZoom,
  wheelZoomEnabled = true,
  wheelZoomAnchorY,
  viewCenterOffsetY = 0,
  dissolveProgress,
  onCharacterProjection,
  onZoomChange,
  onEngineReady,
  onStatus,
  sharedStageRenderer
}: VrmStageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const speechBubbleRef = useRef<HTMLDivElement | null>(null);
  const protectionFeedbackRef = useRef<HTMLDivElement | null>(null);
  const avatarFitConfigRef = useRef(avatarFitConfig);
  const holdMicroMotionEnabledRef = useRef(holdMicroMotionEnabled);
  const footIkEnabledRef = useRef(footIkEnabled);
  const ttsProviderRef = useRef(ttsProvider);
  const headTouchFeedbackRef = useRef<ReturnType<typeof createHeadTouchFeedback> | null>(null);
  const entryHeadTouchFiredRef = useRef(false);
  const modelDragRef = useRef(onModelDrag);
  modelDragRef.current = onModelDrag;
  const rotationEnabledRef = useRef(rotationEnabled);
  rotationEnabledRef.current = rotationEnabled;
  // Read through refs instead of the effect's dependency list: that effect also
  // builds the camera, so depending on them would tear the whole stage down and
  // back up on every wheel tick.
  const initialZoomRef = useRef(initialZoom ?? DEFAULT_CAMERA_ZOOM);
  if (initialZoom !== undefined) initialZoomRef.current = initialZoom;
  const controlledZoomRef = useRef(controlledZoom);
  controlledZoomRef.current = controlledZoom;
  const wasControlled = useRef(controlledZoom !== undefined);
  const wheelZoomEnabledRef = useRef(wheelZoomEnabled);
  wheelZoomEnabledRef.current = wheelZoomEnabled;
  const wheelZoomAnchorYRef = useRef(wheelZoomAnchorY);
  wheelZoomAnchorYRef.current = wheelZoomAnchorY;
  const viewCenterOffsetYRef = useRef(viewCenterOffsetY);
  viewCenterOffsetYRef.current = viewCenterOffsetY;
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const framingBounds = useRef<THREE.Box3 | null>(null);
  const characterProjectionRef = useRef(onCharacterProjection);
  const dissolveProgressRef = useRef(dissolveProgress);
  const dissolveEffectRef = useRef<ReturnType<typeof createEmissiveDissolveEffect> | null>(null);
  const zoomChangeRef = useRef(onZoomChange);
  zoomChangeRef.current = onZoomChange;
  dissolveProgressRef.current = dissolveProgress;
  characterProjectionRef.current = onCharacterProjection;
  const engineRef = useRef<CharacterController | null>(null);
  const renderConfigRef = useRef(renderConfig);
  const proportionConfigRef = useRef(proportionConfig);
  const proportionRigRef = useRef<ReturnType<typeof createCharacterProportionRig> | null>(null);
  const materialSetupsRef = useRef<CharacterMaterialSetup[]>([]);
  const lightingRef = useRef<CharacterLighting | null>(null);
  const vrmRef = useRef<Awaited<ReturnType<VrmModelLoader['load']>> | null>(null);
  const avatarFitGuideRef = useRef<AvatarFitGuide | null>(null);
  const contactShadowRef = useRef<THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null>(null);
  const hairHighlightTextureRef = useRef<THREE.Texture | null>(null);
  const mtoonAoTextureRef = useRef<THREE.Texture | null>(null);
  const protectionFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [protectionFeedbackKey, setProtectionFeedbackKey] = useState(0);
  const [modelReady, setModelReady] = useState(false);
  const [showProtectionFeedback, setShowProtectionFeedback] = useState(false);
  const [localSpeechBubble, setLocalSpeechBubble] = useState<SpeechBubbleState>({
    text: '',
    speaking: false
  });
  const { remoteSpeechBubble } = useRemoteSpeechBubble(modelUrl, characterId, acceptsUntargetedSpeech);
  const speechBubble = remoteSpeechBubble.text ? remoteSpeechBubble : localSpeechBubble;

  const triggerProtectionFeedback = () => {
    setProtectionFeedbackKey((key) => key + 1);
    setShowProtectionFeedback(true);
    if (protectionFeedbackTimerRef.current) clearTimeout(protectionFeedbackTimerRef.current);
    protectionFeedbackTimerRef.current = setTimeout(() => setShowProtectionFeedback(false), 1200);
  };

  useEffect(() => {
    const feedback = createHeadTouchFeedback();
    headTouchFeedbackRef.current = feedback;
    return () => {
      feedback.dispose();
      headTouchFeedbackRef.current = null;
    };
  }, []);

  useEffect(() => {
    proportionConfigRef.current = proportionConfig;
    proportionRigRef.current?.apply(proportionConfig);
    if (controlledZoomRef.current !== undefined && vrmRef.current && cameraRef.current) {
      vrmRef.current.scene.updateMatrixWorld(true);
      framingBounds.current = new THREE.Box3().setFromObject(vrmRef.current.scene);
      fitStageCamera(cameraRef.current, framingBounds.current, controlledZoomRef.current);
    }
  }, [proportionConfig]);

  useEffect(() => {
    const camera = cameraRef.current;
    if (!camera || controlledZoomRef.current !== undefined) return;
    const centerY = 0.78 + viewCenterOffsetY;
    setCameraZoomKeepingFootPosition(camera, camera.zoom, centerY);
  }, [viewCenterOffsetY]);

  useEffect(() => {
    if (dissolveProgress === undefined || dissolveProgress >= 1) {
      dissolveEffectRef.current?.dispose();
      dissolveEffectRef.current = null;
    }
    if (dissolveProgress === undefined) {
      entryHeadTouchFiredRef.current = false;
      return;
    }
    if (dissolveProgress <= 0) entryHeadTouchFiredRef.current = false;
    if (dissolveProgress < 1 && !dissolveEffectRef.current && vrmRef.current) {
      dissolveEffectRef.current = createEmissiveDissolveEffect(vrmRef.current.scene);
    }
    dissolveEffectRef.current?.setProgress(dissolveProgress);
    if (dissolveProgress >= 1 && !entryHeadTouchFiredRef.current && vrmRef.current) {
      entryHeadTouchFiredRef.current = true;
      animateHeadFeedback(vrmRef.current.scene, [1.08, 0.88, 1.08]);
      headTouchFeedbackRef.current?.play(ENTRY_HEAD_TOUCH_SOUND_URL);
    }
  }, [dissolveProgress]);

  useEffect(() => {
    const camera = cameraRef.current;
    if (!camera || wheelZoomEnabled || controlledZoom !== undefined) return;
    camera.zoom = DEFAULT_CAMERA_ZOOM;
    camera.updateProjectionMatrix();
    zoomChangeRef.current?.(DEFAULT_CAMERA_ZOOM);
  }, [wheelZoomEnabled, controlledZoom]);

  useEffect(() => {
    const camera = cameraRef.current;
    if (camera) {
      if (controlledZoom !== undefined && framingBounds.current) fitStageCamera(camera, framingBounds.current, controlledZoom);
      else if (wasControlled.current && controlledZoom === undefined) {
        camera.position.x = 0;
        setCameraZoomKeepingFootPosition(camera, initialZoomRef.current, 0.78 + viewCenterOffsetYRef.current);
      }
    }
    wasControlled.current = controlledZoom !== undefined;
    if (characterId) sharedStageRenderer?.invalidate(characterId);
  }, [controlledZoom, characterId, sharedStageRenderer]);

  useEffect(() => {
    renderConfigRef.current = renderConfig;
    const lighting = lightingRef.current;
    if (lighting) {
      applyRenderConfig(
        materialSetupsRef.current,
        lighting,
        renderConfig,
        hairHighlightTextureRef.current,
        mtoonAoTextureRef.current
      );
    }
    if (characterId) sharedStageRenderer?.invalidate(characterId);
  }, [renderConfig, characterId, sharedStageRenderer]);

  useEffect(() => {
    avatarFitConfigRef.current = avatarFitConfig;
    if (avatarFitGuideRef.current) {
      avatarFitGuideRef.current.group.visible = avatarFitConfig.showGuide;
    }
    avatarFitGuideRef.current?.update(avatarFitConfig);
  }, [avatarFitConfig]);

  useEffect(() => {
    holdMicroMotionEnabledRef.current = holdMicroMotionEnabled;
    engineRef.current?.setHoldMicroMotionEnabled(holdMicroMotionEnabled);
  }, [holdMicroMotionEnabled]);

  useEffect(() => {
    footIkEnabledRef.current = footIkEnabled;
    engineRef.current?.setFootIkEnabled(footIkEnabled);
  }, [footIkEnabled]);

  useEffect(() => {
    ttsProviderRef.current = ttsProvider;
    if (ttsProvider) {
      engineRef.current?.speech.cancel();
      engineRef.current?.tts.setProvider(ttsProvider);
    }
  }, [ttsProvider]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    let disposed = false;
    setModelReady(false);
    let animationFrame = 0;
    let engine: CharacterController | undefined;
    let previousTime = performance.now();
    let modelBaseRotationY = 0;
    let viewRotationY = 0;
    let dragState: { pointerId: number; startX: number; startY: number; lastX: number; dragging: boolean } | null = null;
    let pendingWindowDrag: { pointerId: number; startX: number; startY: number; headHit: boolean } | null =
      null;
    let modelHitTest: ModelHitTest | null = null;
    let unsubscribeSpeech: (() => void) | undefined;
    let localSpeechBubbleTimeline: SpeechBubbleTimeline | undefined;
    const abortController = new AbortController();
    // Started here rather than at the first utterance: loading the worklet takes
    // a moment, and the first line should not have to go without a mouth. The
    // context it creates stays suspended until a gesture resumes it below.
    prepareVisemeAnalyzer();
    const scene = new THREE.Scene();
    const spatialRoot = new THREE.Group();
    const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 20);
    const initialZoom = clampCameraZoom(
      controlledZoomRef.current ?? (wheelZoomEnabledRef.current ? initialZoomRef.current : DEFAULT_CAMERA_ZOOM)
    );
    cameraRef.current = camera;
    if (!wheelZoomEnabledRef.current && controlledZoomRef.current === undefined) zoomChangeRef.current?.(DEFAULT_CAMERA_ZOOM);
    let renderer = sharedStageRenderer?.webglRenderer;
    if (!renderer) {
      const webglContext = canvas.getContext('webgl2', { alpha: true, antialias: true });
      if (!webglContext) {
        onStatus('WebGL2 unavailable: browser could not create a WebGL2 context.');
        return () => abortController.abort();
      }
      try {
        renderer = new THREE.WebGLRenderer({ canvas, context: webglContext as unknown as WebGLRenderingContext, alpha: true, antialias: true });
      } catch (error: unknown) {
        onStatus(error instanceof Error ? `WebGL unavailable: ${error.message}` : 'WebGL unavailable');
        return () => abortController.abort();
      }
    }

    const viewport = canvas.parentElement ?? canvas;
    const resize = () => {
      if (sharedStageRenderer) sharedStageRenderer.resizeViewport(camera, viewport);
      else resizeRenderer(renderer!, camera, canvas);
      if (controlledZoomRef.current !== undefined && framingBounds.current) fitStageCamera(camera, framingBounds.current, controlledZoomRef.current);
    };
    const resizeObserver = new ResizeObserver(resize);

    const centerY = 0.78 + viewCenterOffsetYRef.current;
    camera.position.set(0, centerY, 3.4);
    setCameraZoomKeepingFootPosition(camera, initialZoom, centerY);

    scene.add(spatialRoot);
    if (!sharedStageRenderer) renderer.setClearColor(0x000000, 0);
    resizeObserver.observe(canvas);
    resize();
    const unregisterStageActor = sharedStageRenderer?.register({
      id: characterId ?? modelUrl,
      scene,
      camera,
      viewport,
      update: (deltaSeconds, now) => updateFrame(deltaSeconds, now),
      updateRate: () => 60
    });
    hairHighlightTextureRef.current = createHairHighlightTexture();
    mtoonAoTextureRef.current = createMToonAoTexture();
    onStatus(`Loading ${modelUrl}`);

    void new VrmModelLoader({ optimizeMesh: false })
      .load(modelUrl, abortController.signal)
      .then((vrm) => {
        if (disposed) {
          disposeCharacterModel(vrm);
          return;
        }

        vrm.scene.position.set(0, 0, 0);
        modelBaseRotationY = getVrmFrontRotationY(vrm);
        applyViewRotation(vrm.scene, modelBaseRotationY, viewRotationY);
        spatialRoot.add(vrm.scene);
        vrmRef.current = vrm;
        proportionRigRef.current = createCharacterProportionRig(vrm);
        proportionRigRef.current.apply(proportionConfigRef.current);
        vrm.scene.updateMatrixWorld(true);
        framingBounds.current = new THREE.Box3().setFromObject(vrm.scene);
        if (controlledZoomRef.current !== undefined) fitStageCamera(camera, framingBounds.current, controlledZoomRef.current);
        if (characterProjectionRef.current) {
          vrm.scene.updateMatrixWorld(true);
          const bounds = new THREE.Box3().setFromObject(vrm.scene);
          const x = (bounds.min.x + bounds.max.x) / 2;
          const z = (bounds.min.z + bounds.max.z) / 2;
          const projectY = (y: number) =>
            THREE.MathUtils.clamp((1 - new THREE.Vector3(x, y, z).project(camera).y) * 50, 0, 100);
          characterProjectionRef.current({ footY: projectY(bounds.min.y), headY: projectY(bounds.max.y) });
        }
        modelHitTest = createVrmHitTest(vrm, camera, canvas, () => avatarFitConfigRef.current);
        onHitTestReady?.(modelHitTest);

        materialSetupsRef.current = setupMToonMaterials(vrm);
        if (dissolveProgressRef.current !== undefined && dissolveProgressRef.current < 1) {
          dissolveEffectRef.current = createEmissiveDissolveEffect(vrm.scene);
          dissolveEffectRef.current.setProgress(dissolveProgressRef.current);
        }
        lightingRef.current = setupCharacterLighting(scene);
        contactShadowRef.current = createContactShadow(scene);
        avatarFitGuideRef.current = new AvatarFitGuide(vrm);
        scene.add(avatarFitGuideRef.current.group);
        avatarFitGuideRef.current.group.visible = avatarFitConfigRef.current.showGuide;
        avatarFitGuideRef.current.update(avatarFitConfigRef.current);
        applyRenderConfig(
          materialSetupsRef.current,
          lightingRef.current,
          renderConfigRef.current,
          hairHighlightTextureRef.current,
          mtoonAoTextureRef.current
        );

        const createdEngine = createCharacterController(vrm, {
          persist: false,
          ttsProvider: ttsProviderRef.current,
          characterStateManager,
          holdMicroMotionEnabled: holdMicroMotionEnabledRef.current,
          footIkEnabled: footIkEnabledRef.current,
          getFootGroundOffset: () => avatarFitConfigRef.current.footGroundOffset,
          vrmaLoader: {
            getAvatarFitConfig: () => avatarFitConfigRef.current
          },
          spatialRoot,
          spatialBaseRotationY: 0,
          accessoryRig: {
            tailBones: characterConfig.tailBones,
            earBones: characterConfig.earBones
          },
          interactionEffects: {
            onHeadSquash: () => {
              animateHeadFeedback(vrm.scene, [1.08, 0.88, 1.08]);
              headTouchFeedbackRef.current?.play();
            },
            onProtectedHeadTap: () => {
              animateHeadFeedback(vrm.scene, [1.035, 0.95, 1.035], 130);
              headTouchFeedbackRef.current?.playProtected();
              triggerProtectionFeedback();
            },
            onProtectionStart: () => {
              triggerProtectionFeedback();
            }
          }
        });
        engine = createdEngine;
        engineRef.current = createdEngine;
        // The bubble follows `bubbleVisible`, not `speaking`: lip sync closes
        // TRAILING_SILENCE_MS early, and the bubble must survive that tail.
        const bubbleTimeline = new SpeechBubbleTimeline({ onChange: setLocalSpeechBubble });
        localSpeechBubbleTimeline = bubbleTimeline;
        let lastSpeechText = '';
        let lastBubbleVisible = false;
        const updateSpeechBubble = () => {
          const speech = createdEngine.store.getSnapshot().speech;
          if (speech.text === lastSpeechText && speech.bubbleVisible === lastBubbleVisible) return;
          lastSpeechText = speech.text;
          lastBubbleVisible = speech.bubbleVisible;
          if (speech.bubbleVisible) bubbleTimeline.show(speech.text);
          else if (speech.text) bubbleTimeline.finish();
          else bubbleTimeline.hide();
        };
        unsubscribeSpeech = createdEngine.store.subscribe(updateSpeechBubble);
        updateSpeechBubble();
        afterFirstStageRender(scene, abortController.signal, () => {
          setModelReady(true);
          onEngineReady(createdEngine);
          onStatus(`Loaded ${modelUrl}`);
        });
      })
      .catch((error: unknown) => {
        if (!disposed) {
          onStatus(error instanceof Error ? error.message : String(error));
        }
      });

    const cancelDrag = () => {
      const pointerId = dragState?.pointerId;
      dragState = null;
      pendingWindowDrag = null;
      delete canvas.dataset.dragging;
      if (pointerId !== undefined && canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) {
        return;
      }

      // Resume from the user gesture before hit testing or action dispatch.
      void headTouchFeedbackRef.current?.unlock().catch((error) => {
        console.error('Unable to unlock head touch audio', error);
      });
      // Same gesture, same reason: autoplay policy keeps the lip sync context
      // suspended until the window is interacted with.
      unlockVisemeAnalyzer();

      // One bone-capsule pass answers both questions the handlers need — did the
      // pointer land on the character, and was it the head — so a tap never
      // walks skinned vertices.
      const hitPart = modelHitTest?.(event.clientX, event.clientY) ?? null;

      if (modelDragRef.current) {
        if (event.isPrimary && hitPart) {
          pendingWindowDrag = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            headHit: hitPart === 'head'
          };
          event.preventDefault();
        }
        return;
      }

      if (engine && hitPart === 'head') engine.actions.headClick();
      if (!rotationEnabledRef.current) return;
      dragState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        dragging: false
      };
      canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
    };

    const handlePointerMove = (event: PointerEvent) => {
      if ((event.buttons & 1) === 0) {
        cancelDrag();
        return;
      }
      if (pendingWindowDrag?.pointerId === event.pointerId) {
        if (
          Math.hypot(event.clientX - pendingWindowDrag.startX, event.clientY - pendingWindowDrag.startY) > 4
        ) {
          pendingWindowDrag = null;
          modelDragRef.current?.();
        }
        event.preventDefault();
        return;
      }
      if (!rotationEnabledRef.current) {
        cancelDrag();
        return;
      }
      if (!dragState || event.pointerId !== dragState.pointerId) {
        return;
      }

      if (!dragState.dragging) {
        if (Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY) <= 4) return;
        dragState.dragging = true;
        canvas.dataset.dragging = 'true';
      }

      const deltaX = event.clientX - dragState.lastX;
      dragState.lastX = event.clientX;
      viewRotationY += deltaX * 0.012;
      if (vrmRef.current) {
        applyViewRotation(vrmRef.current.scene, modelBaseRotationY, viewRotationY);
      }
      event.preventDefault();
    };

    const endDrag = (event: PointerEvent) => {
      if (pendingWindowDrag?.pointerId === event.pointerId) {
        if (event.type === 'pointerup' && pendingWindowDrag.headHit) engine?.actions.headClick();
        pendingWindowDrag = null;
        return;
      }
      if (!dragState || event.pointerId !== dragState.pointerId) {
        return;
      }

      cancelDrag();
    };

    const handleWheel = (event: WheelEvent) => {
      if (!wheelZoomEnabledRef.current) return;
      event.preventDefault();
      if (controlledZoomRef.current !== undefined && framingBounds.current) {
        const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1);
        const zoom = Math.max(0.3, Math.min(6, controlledZoomRef.current * Math.exp(-delta * 0.001)));
        fitStageCamera(camera, framingBounds.current, zoom);
        zoomChangeRef.current?.(zoom);
        return;
      }
      applyWheelZoom(camera, event.deltaY, event.deltaMode, canvas.clientHeight, wheelZoomAnchorYRef.current);
      zoomChangeRef.current?.(camera.zoom);
    };
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', endDrag, true);
    window.addEventListener('pointercancel', endDrag, true);
    canvas.addEventListener('lostpointercapture', cancelDrag);
    window.addEventListener('blur', cancelDrag);

    const updateFrame = (deltaSeconds: number, now: number) => {
      engine?.update(deltaSeconds);
      updateHeadOverlayPosition(
        vrmRef.current,
        camera,
        speechBubbleRef.current,
        0.14 +
          avatarFitConfigRef.current.colliders.head.radius *
            (proportionConfigRef.current.chibiEnabled ? proportionConfigRef.current.headScale : 1)
      );
      // The bowl is `display: none` while it is not showing, so pushing a projected
      // head position into it every frame only produced style invalidations for an
      // element nobody can see. It is positioned on the first frame it reappears.
      const protectionFeedback = protectionFeedbackRef.current;
      if (protectionFeedback && !protectionFeedback.hidden) {
        updateHeadOverlayPosition(
          vrmRef.current,
          camera,
          protectionFeedback,
          0.08 + avatarFitConfigRef.current.colliders.head.radius * 2 * PROTECTION_HEAD_HEIGHT_OFFSET
        );
      }
      updateLipSync(
        vrmRef.current,
        (engine?.store.getSnapshot().speech.speaking ?? false) ||
          (headTouchFeedbackRef.current?.isPlaying() ?? false),
        // Already seconds: `now` is `time / 1000` from the frame loop. Dividing
        // again ran the procedural mouth a thousand times too slow.
        now,
        readLiveVisemeWeights()
      );
      if (avatarFitGuideRef.current?.group.visible) {
        avatarFitGuideRef.current.update(avatarFitConfigRef.current);
      }
      updateContactShadow(vrmRef.current, contactShadowRef.current, renderConfigRef.current);
      if (!sharedStageRenderer) renderer.render(scene, camera);
    };

    if (!sharedStageRenderer) {
      const loop = (time: number) => {
        updateFrame(Math.min(0.05, Math.max(0, (time - previousTime) / 1000)), time / 1000);
        previousTime = time;
        animationFrame = requestAnimationFrame(loop);
      };
      animationFrame = requestAnimationFrame(loop);
    }

    return () => {
      disposed = true;
      onHitTestReady?.(null);
      abortController.abort();
      engine?.interaction.dispose();
      engine?.speech.cancel();
      engine?.microdynamics.dispose();
      void engine?.actionRuntime.stopAll();
      unsubscribeSpeech?.();
      localSpeechBubbleTimeline?.dispose();
      setLocalSpeechBubble({ text: '', speaking: false });

      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      unregisterStageActor?.();
      canvas.removeEventListener('wheel', handleWheel);
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', endDrag, true);
      window.removeEventListener('pointercancel', endDrag, true);
      canvas.removeEventListener('lostpointercapture', cancelDrag);
      window.removeEventListener('blur', cancelDrag);
      cancelDrag();
      if (!sharedStageRenderer) renderer.dispose();
      materialSetupsRef.current = [];
      dissolveEffectRef.current?.dispose();
      dissolveEffectRef.current = null;
      lightingRef.current = null;
      if (avatarFitGuideRef.current) {
        scene.remove(avatarFitGuideRef.current.group);
        avatarFitGuideRef.current.dispose();
        avatarFitGuideRef.current = null;
      }
      if (vrmRef.current) {
        cancelHeadFeedback(vrmRef.current.scene);
        disposeCharacterModel(vrmRef.current);
      }
      proportionRigRef.current?.dispose();
      proportionRigRef.current = null;
      vrmRef.current = null;
      engineRef.current = null;
      if (protectionFeedbackTimerRef.current) clearTimeout(protectionFeedbackTimerRef.current);
      contactShadowRef.current?.material.map?.dispose();
      contactShadowRef.current?.material.dispose();
      contactShadowRef.current?.geometry.dispose();
      contactShadowRef.current = null;
      hairHighlightTextureRef.current?.dispose();
      hairHighlightTextureRef.current = null;
      mtoonAoTextureRef.current?.dispose();
      mtoonAoTextureRef.current = null;
      cameraRef.current = null;
      framingBounds.current = null;
    };
  }, [modelUrl, onEngineReady, onStatus, onHitTestReady, sharedStageRenderer]);

  return (
    <div className="vrmStageRoot" aria-busy={!modelReady}>
      <canvas
        ref={canvasRef}
        className="vrmCanvas"
        data-shared={Boolean(sharedStageRenderer)}
        style={getCanvasStyle(renderConfig)}
      />
      {speechBubbleEnabled && speechBubble.text ? (
        <div ref={speechBubbleRef} className="vrmSpeechBubble" data-speaking={speechBubble.speaking}>
          {speechBubble.text}
        </div>
      ) : null}
      <div
        ref={protectionFeedbackRef}
        key={protectionFeedbackKey}
        className="protectedEffect"
        hidden={!showProtectionFeedback}
      >
        <img src="/assets/fx/iron-basin.png" alt="防摸头铁盆" width={110} height={80} />
        <small>防摸头</small>
      </div>
    </div>
  );
}

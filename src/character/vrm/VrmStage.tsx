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
import { VrmModelLoader } from './VrmModelLoader';
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
import { createHeadTouchFeedback } from './headTouchAudio';
import {
  resizeRenderer,
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

// Extra lift measured in head heights: 0.5 raises the basin by half a head.
const PROTECTION_HEAD_HEIGHT_OFFSET = 0.5;

interface VrmStageProps {
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
  /**
   * Wheel zoom the camera starts at, and restarts from whenever the stage is
   * rebuilt for a new model. The wheel keeps working from there; whether the
   * result is worth remembering is the owner's decision, which is why nothing
   * here touches storage.
   */
  initialZoom?: number;
  /** Disable wheel zoom for stages whose owner applies a fixed character framing. */
  wheelZoomEnabled?: boolean;
  /** Keep this world-space height fixed on screen during wheel zoom. */
  wheelZoomAnchorY?: number;
  /** Shift the camera's framing center vertically while keeping its viewing direction. */
  viewCenterOffsetY?: number;
  /** Fires after each wheel zoom with the new camera zoom. */
  onZoomChange?(zoom: number): void;
  onEngineReady(engine: CharacterController): void;
  onStatus(message: string): void;
}

export function VrmStage({
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
  initialZoom,
  wheelZoomEnabled = true,
  wheelZoomAnchorY,
  viewCenterOffsetY = 0,
  onZoomChange,
  onEngineReady,
  onStatus
}: VrmStageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const speechBubbleRef = useRef<HTMLDivElement | null>(null);
  const protectionFeedbackRef = useRef<HTMLDivElement | null>(null);
  const avatarFitConfigRef = useRef(avatarFitConfig);
  const holdMicroMotionEnabledRef = useRef(holdMicroMotionEnabled);
  const footIkEnabledRef = useRef(footIkEnabled);
  const ttsProviderRef = useRef(ttsProvider);
  const headTouchFeedbackRef = useRef<ReturnType<typeof createHeadTouchFeedback> | null>(null);
  const modelDragRef = useRef(onModelDrag);
  modelDragRef.current = onModelDrag;
  // Read through refs instead of the effect's dependency list: that effect also
  // builds the camera, so depending on them would tear the whole stage down and
  // back up on every wheel tick.
  const initialZoomRef = useRef(initialZoom ?? DEFAULT_CAMERA_ZOOM);
  if (initialZoom !== undefined) initialZoomRef.current = initialZoom;
  const wheelZoomEnabledRef = useRef(wheelZoomEnabled);
  wheelZoomEnabledRef.current = wheelZoomEnabled;
  const wheelZoomAnchorYRef = useRef(wheelZoomAnchorY);
  wheelZoomAnchorYRef.current = wheelZoomAnchorY;
  const viewCenterOffsetYRef = useRef(viewCenterOffsetY);
  viewCenterOffsetYRef.current = viewCenterOffsetY;
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const zoomChangeRef = useRef(onZoomChange);
  zoomChangeRef.current = onZoomChange;
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
  const [showProtectionFeedback, setShowProtectionFeedback] = useState(false);
  const [localSpeechBubble, setLocalSpeechBubble] = useState<SpeechBubbleState>({
    text: '',
    speaking: false
  });
  const { remoteSpeechBubble } = useRemoteSpeechBubble(modelUrl);
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
  }, [proportionConfig]);

  useEffect(() => {
    const camera = cameraRef.current;
    if (!camera) return;
    const centerY = 0.78 + viewCenterOffsetY;
    setCameraZoomKeepingFootPosition(camera, camera.zoom, centerY);
  }, [viewCenterOffsetY]);

  useEffect(() => {
    const camera = cameraRef.current;
    if (!camera || wheelZoomEnabled) return;
    camera.zoom = DEFAULT_CAMERA_ZOOM;
    camera.updateProjectionMatrix();
    zoomChangeRef.current?.(DEFAULT_CAMERA_ZOOM);
  }, [wheelZoomEnabled]);

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
  }, [renderConfig]);

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
    let animationFrame = 0;
    let engine: CharacterController | undefined;
    let previousTime = performance.now();
    let modelBaseRotationY = 0;
    let viewRotationY = 0;
    let dragState: { pointerId: number; lastX: number } | null = null;
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
    const initialZoom = clampCameraZoom(wheelZoomEnabledRef.current ? initialZoomRef.current : DEFAULT_CAMERA_ZOOM);
    cameraRef.current = camera;
    if (!wheelZoomEnabledRef.current) zoomChangeRef.current?.(DEFAULT_CAMERA_ZOOM);
    let renderer: THREE.WebGLRenderer;
    const webglContext = canvas.getContext('webgl2', {
      alpha: true,
      antialias: true
    });

    if (!webglContext) {
      onStatus('WebGL2 unavailable: browser could not create a WebGL2 context.');
      return () => abortController.abort();
    }

    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        context: webglContext as unknown as WebGLRenderingContext,
        alpha: true,
        antialias: true
      });
    } catch (error: unknown) {
      onStatus(error instanceof Error ? `WebGL unavailable: ${error.message}` : 'WebGL unavailable');
      return () => abortController.abort();
    }

    const resizeObserver = new ResizeObserver(() => resizeRenderer(renderer, camera, canvas));

    const centerY = 0.78 + viewCenterOffsetYRef.current;
    camera.position.set(0, centerY, 3.4);
    setCameraZoomKeepingFootPosition(camera, initialZoom, centerY);

    scene.add(spatialRoot);
    renderer.setClearColor(0x000000, 0);
    resizeObserver.observe(canvas);
    resizeRenderer(renderer, camera, canvas);
    hairHighlightTextureRef.current = createHairHighlightTexture();
    mtoonAoTextureRef.current = createMToonAoTexture();
    onStatus(`Loading ${modelUrl}`);

    void new VrmModelLoader({ optimizeMesh: false })
      .load(modelUrl, abortController.signal)
      .then((vrm) => {
        if (disposed) {
          return;
        }

        vrm.scene.position.set(0, 0, 0);
        modelBaseRotationY = getVrmFrontRotationY(vrm);
        applyViewRotation(vrm.scene, modelBaseRotationY, viewRotationY);
        spatialRoot.add(vrm.scene);
        vrmRef.current = vrm;
        proportionRigRef.current = createCharacterProportionRig(vrm);
        proportionRigRef.current.apply(proportionConfigRef.current);
        modelHitTest = createVrmHitTest(vrm, camera, canvas, () => avatarFitConfigRef.current);
        onHitTestReady?.(modelHitTest);

        materialSetupsRef.current = setupMToonMaterials(vrm);
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
        onEngineReady(createdEngine);
        onStatus(`Loaded ${modelUrl}`);
      })
      .catch((error: unknown) => {
        if (!disposed) {
          onStatus(error instanceof Error ? error.message : String(error));
        }
      });

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
          event.preventDefault();
          if (hitPart === 'head') engine?.actions.headClick();
          else modelDragRef.current();
        }
        return;
      }

      dragState = {
        pointerId: event.pointerId,
        lastX: event.clientX
      };
      canvas.setPointerCapture(event.pointerId);
      canvas.dataset.dragging = 'true';
      if (engine && hitPart === 'head') engine.actions.headClick();
      event.preventDefault();
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!dragState || event.pointerId !== dragState.pointerId) {
        return;
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
      if (!dragState || event.pointerId !== dragState.pointerId) {
        return;
      }

      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
      dragState = null;
      delete canvas.dataset.dragging;
    };

    const handleWheel = (event: WheelEvent) => {
      if (!wheelZoomEnabledRef.current) return;
      event.preventDefault();
      applyWheelZoom(camera, event.deltaY, event.deltaMode, canvas.clientHeight, wheelZoomAnchorYRef.current);
      zoomChangeRef.current?.(camera.zoom);
    };
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    const loop = () => {
      const now = performance.now();
      const deltaSeconds = Math.min(0.05, (now - previousTime) / 1000);
      previousTime = now;
      engine?.update(deltaSeconds);
      updateHeadOverlayPosition(
        vrmRef.current,
        camera,
        speechBubbleRef.current,
        0.14 +
          avatarFitConfigRef.current.colliders.head.radius *
            (proportionConfigRef.current.chibiEnabled ? proportionConfigRef.current.headScale : 1)
      );
      updateHeadOverlayPosition(
        vrmRef.current,
        camera,
        protectionFeedbackRef.current,
        0.08 + avatarFitConfigRef.current.colliders.head.radius * 2 * PROTECTION_HEAD_HEIGHT_OFFSET
      );
      updateLipSync(
        vrmRef.current,
        (engine?.store.getSnapshot().speech.speaking ?? false) ||
          (headTouchFeedbackRef.current?.isPlaying() ?? false),
        now / 1000,
        readLiveVisemeWeights()
      );
      if (avatarFitGuideRef.current?.group.visible) {
        avatarFitGuideRef.current.update(avatarFitConfigRef.current);
      }
      updateContactShadow(vrmRef.current, contactShadowRef.current, renderConfigRef.current);
      renderer.render(scene, camera);
      animationFrame = requestAnimationFrame(loop);
    };

    loop();

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
      canvas.removeEventListener('wheel', handleWheel);
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerup', endDrag);
      canvas.removeEventListener('pointercancel', endDrag);
      renderer.dispose();
      materialSetupsRef.current = [];
      lightingRef.current = null;
      if (avatarFitGuideRef.current) {
        scene.remove(avatarFitGuideRef.current.group);
        avatarFitGuideRef.current.dispose();
        avatarFitGuideRef.current = null;
      }
      if (vrmRef.current) cancelHeadFeedback(vrmRef.current.scene);
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
    };
  }, [modelUrl, onEngineReady, onStatus, onHitTestReady]);

  return (
    <div className="vrmStageRoot">
      <canvas ref={canvasRef} className="vrmCanvas" style={getCanvasStyle(renderConfig)} />
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

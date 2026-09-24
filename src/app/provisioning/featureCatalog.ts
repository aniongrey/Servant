import type { FeatureId, ProvisioningFeatureSelection } from './provisioningTypes.ts';

/**
 * How each capability is presented in the setup wizard.
 *
 * The wizard prepares *resources*, not features: the downloadable list comes
 * from the server manifest, and this table only supplies the label a resource
 * row groups under ("this download is what enables 语音识别"). Feature flags are
 * derived back out of the user's resource choice, see
 * {@link featuresFromResources}.
 */
export interface FeaturePresentation {
  id: FeatureId;
  title: string;
  /** Single-glyph icon rendered by the wizard. */
  icon: string;
}

export const FEATURE_PRESENTATION: readonly FeaturePresentation[] = [
  { id: 'companion', title: '对话伙伴', icon: '💬' },
  { id: 'voice', title: '语音合成', icon: '🔊' },
  { id: 'stt', title: '语音识别', icon: '🎤' },
  { id: 'memory', title: '长期记忆', icon: '🧠' }
];

export function featurePresentation(id: FeatureId): FeaturePresentation {
  return FEATURE_PRESENTATION.find((feature) => feature.id === id) ?? FEATURE_PRESENTATION[0];
}

/**
 * Feature flags implied by the resources the user chose to download.
 *
 * `companion` and `voice` ship no local model — they are configured later in
 * settings — so they stay on; `stt` and `memory` follow their resource, which is
 * what makes "只下载资源" a complete answer for what the user enabled.
 */
export function featuresFromResources(
  resources: readonly { feature: FeatureId }[]
): ProvisioningFeatureSelection {
  const selected = new Set(resources.map((resource) => resource.feature));
  return {
    companion: true,
    voice: true,
    stt: selected.has('stt'),
    memory: selected.has('memory')
  };
}

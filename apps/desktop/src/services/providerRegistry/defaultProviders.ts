import { t } from '@services/libs/i18n/placeholder';

import type { ModelFeature } from './interface';

/** Renderer labels for Core model-catalog capabilities. */
const modelFeatures: readonly { value: ModelFeature; label: string; i18nKey: string }[] = [
  { value: 'language', label: 'Language', i18nKey: t('ModelFeature.Language') },
  { value: 'reasoning', label: 'Reasoning', i18nKey: t('ModelFeature.Reasoning') },
  { value: 'toolCalling', label: 'Tool Calling', i18nKey: t('ModelFeature.ToolCalling') },
  { value: 'vision', label: 'Vision', i18nKey: t('ModelFeature.Vision') },
  { value: 'imageGeneration', label: 'Image Generation', i18nKey: t('ModelFeature.ImageGeneration') },
  { value: 'embedding', label: 'Embedding', i18nKey: t('ModelFeature.Embedding') },
  { value: 'speech', label: 'Speech', i18nKey: t('ModelFeature.Speech') },
  { value: 'transcriptions', label: 'Transcriptions', i18nKey: t('ModelFeature.Transcriptions') },
  { value: 'free', label: 'Free', i18nKey: t('ModelFeature.Free') },
];

export default { modelFeatures };
export { modelFeatures };

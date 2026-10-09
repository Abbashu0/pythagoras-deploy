import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { NativePreviewTuning } from './native-preview-tuning.dev';

export type FittedUserMessagePreviewProps = {
  source: string;
  logicalMaxWidth?: number;
  foregroundColor: string;
  backgroundColor: string;
  borderColor: string;
  direction: 'ltr' | 'rtl';
  fontStyle: 'body';
  lineSpacing: number;
  horizontalPadding: number;
  verticalPadding: number;
  borderWidth: number;
  cornerRadius: number;
} & Partial<NativePreviewTuning>;

// Older builds keep the existing Text fallback. Optical tuning additionally
// requires the one-time native baseline containing the five new @Field props.
export const hasFittedUserMessagePreview = requireOptionalNativeModule('PythagorasChatPreview') !== null;
const NativePreview = hasFittedUserMessagePreview
  ? requireNativeView<FittedUserMessagePreviewProps>('PythagorasChatPreview', 'PythagorasFittedUserMessagePreview')
  : null;

export function PythagorasFittedUserMessagePreview(props: FittedUserMessagePreviewProps) {
  if (!NativePreview) throw new Error('PythagorasChatPreview requires a Development Build containing the local native module.');
  return <NativePreview {...props} />;
}

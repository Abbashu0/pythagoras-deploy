import { requireNativeView, requireOptionalNativeModule } from 'expo';

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
};

// The current installed Development IPA predates this local module. Preserve
// the existing preview there; fitting activates only in a build that links it.
export const hasFittedUserMessagePreview = requireOptionalNativeModule('PythagorasChatPreview') !== null;
const NativePreview = hasFittedUserMessagePreview
  ? requireNativeView<FittedUserMessagePreviewProps>('PythagorasChatPreview', 'PythagorasFittedUserMessagePreview')
  : null;

export function PythagorasFittedUserMessagePreview(props: FittedUserMessagePreviewProps) {
  if (!NativePreview) throw new Error('PythagorasChatPreview requires a Development Build containing the local native module.');
  return <NativePreview {...props} />;
}

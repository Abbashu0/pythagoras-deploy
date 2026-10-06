import { presentUserMessage } from './user-message-presentation';
type Sample = { sendAcceptedAt: number; characters: number; newlines: number; reactUserRowLayoutAt: number | null; nativeUserHostLayoutAt: number | null; firstNonZeroNativeHeightAt: number | null };
const samples = new Map<string, Sample>();
export function beginChatSendTiming(turnId: string, content: string) {
  if (!__DEV__) return;
  samples.set(turnId, { sendAcceptedAt: Date.now(), characters: content.length, newlines: (content.match(/\n/gu) ?? []).length, reactUserRowLayoutAt: null, nativeUserHostLayoutAt: null, firstNonZeroNativeHeightAt: null });
  if (samples.size > 64) samples.delete(samples.keys().next().value!);
  reportChatSendTiming(turnId, 'accepted', 0, presentUserMessage(content).collapsed);
}

type PresentationTiming = {
  revision: number;
  mode: 'expanded' | 'collapsed';
  characters: number;
  pressedAt: number;
  oldHeight: number | null;
  committedAt: number | null;
  firstRNAt: number | null;
  firstNativeAt: number | null;
  rnHeight: number | null;
  nativeHeight: number | null;
  stableHeight: number | null;
};
const presentationSamples = new Map<string, PresentationTiming>();
export function beginChatPresentationTiming(turnId: string, mode: PresentationTiming['mode'], characters: number, oldHeight: number | null) {
  if (!__DEV__) return;
  const revision = (presentationSamples.get(turnId)?.revision ?? 0) + 1;
  presentationSamples.set(turnId, { revision, mode, characters, pressedAt: Date.now(), oldHeight, committedAt: null, firstRNAt: null, firstNativeAt: null, rnHeight: null, nativeHeight: null, stableHeight: null });
  if (presentationSamples.size > 64) presentationSamples.delete(presentationSamples.keys().next().value!);
  reportChatPresentationTiming(turnId, mode, 'press', oldHeight);
}
export function reportChatPresentationTiming(turnId: string, mode: PresentationTiming['mode'], event: 'press' | 'commit' | 'react-row' | 'native-host', height: number | null) {
  if (!__DEV__) return;
  const sample = presentationSamples.get(turnId);
  if (!sample || sample.mode !== mode) return;
  const at = Date.now();
  if (event === 'commit') sample.committedAt ??= at;
  if (event === 'react-row') { sample.firstRNAt ??= at; sample.rnHeight = height; }
  if (event === 'native-host') { sample.firstNativeAt ??= at; sample.nativeHeight = height; }
  console.info('[Chat presentation timing]', { turnId, event, ...sample, at, elapsedMs: at - sample.pressedAt });
  if (sample.rnHeight !== null && sample.nativeHeight !== null && sample.nativeHeight > 0 && Math.abs(sample.rnHeight - sample.nativeHeight) < 0.5 && sample.stableHeight !== sample.nativeHeight) {
    sample.stableHeight = sample.nativeHeight;
    console.info('[Chat presentation timing]', { turnId, event: 'measured-height-agreement', ...sample, at, elapsedMs: at - sample.pressedAt });
  }
}
export function reportChatSendTiming(turnId: string, event: 'accepted' | 'react-row' | 'native-host', height: number, collapsed: boolean) {
  if (!__DEV__) return;
  const sample = samples.get(turnId); if (!sample) return;
  const at = Date.now();
  if (event === 'react-row' && sample.reactUserRowLayoutAt === null) sample.reactUserRowLayoutAt = at;
  if (event === 'native-host') {
    sample.nativeUserHostLayoutAt ??= at;
    if (height > 0) sample.firstNonZeroNativeHeightAt ??= at;
  }
  console.info('[Chat send timing]', { turnId, event, ...sample, collapsed, expanded: !collapsed, rnRowHeight: event === 'react-row' ? height : null, nativeHostHeight: event === 'native-host' ? height : null, elapsedMs: at - sample.sendAcceptedAt });
}

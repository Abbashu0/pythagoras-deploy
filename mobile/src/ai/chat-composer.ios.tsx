import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject, ReactNode } from 'react';
import {
  AccessibilityInfo,
  Alert,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {
  MenuView,
  type MenuAction,
  type NativeActionEvent,
} from '@expo/ui/community/menu';
import { useRouter } from 'expo-router';
import PagerView from 'react-native-pager-view';
import { Freeze } from 'react-freeze';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from 'expo-glass-effect';
import {
  KeyboardController,
  KeyboardProvider,
  KeyboardStickyView,
  useReanimatedKeyboardAnimation,
} from 'react-native-keyboard-controller';
import {
  KeyboardAwareLegendList,
  useKeyboardChatComposerInset,
  useKeyboardScrollToEnd,
} from '@legendapp/list/keyboard';
import {
  LegendList,
  type LegendListRef,
  type LegendListRenderItemProps,
} from '@legendapp/list/react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import Animated, {
  Easing,
  FadeIn,
  ReduceMotion,
  SlideInDown,
  ZoomIn,
  ZoomOut,
  useAnimatedStyle,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { usePreferences } from '@/preferences/preferences-provider';
import { getPalette } from '@/theme';
import type {
  Agent1AssistantActionPolicy,
} from './agent-1-chat-state';
import {
  getAgent1AssistantActionPolicy,
  toggleChatReaction,
} from './agent-1-chat-state';
import type {
  Agent1ChatRenderRow,
} from './chat-list-projection';
import { projectAgent1ChatTurns } from './chat-list-projection';
import type {
  ChatComposerProps,
  ChatLayoutTestCase,
  ChatReaction,
  ChatTurn,
} from './chat-types';
import Agent1EnrichedMarkdown from './assistant-enriched-markdown.ios';
import { ChatShimmerText } from './chat-shimmer-text.ios';
import { firstStrongTextDirection } from './rich-response/text-direction';
import type { Palette } from '@/theme';

const CHAT_PAGE = 1;
const HEADER_BUTTON_SIZE = 44;
const HEADER_TOP_GAP = 6;
const HEADER_SIDE_INSET = 16;
const CHAT_TOP_CONTENT_OFFSET = 56;
const CHAT_SIDE_INSET = 16;
const USER_LINE_HEIGHT = 21;
// The reference cap is two 21pt lines plus the 32pt bubble padding/chrome allowance.
const USER_BUBBLE_ALLOWANCE = 32;
const ANCHOR_MAX_SIZE = 2 * USER_LINE_HEIGHT + USER_BUBBLE_ALLOWANCE;
const USER_BUBBLE_MAX_WIDTH = 0.82;
const USER_BUBBLE_RADIUS = 20;
const COMPOSER_CIRCLE_SIZE = 44;
const COMPOSER_INPUT_MAX_HEIGHT = 120;
const EMPTY_STATE_LOGO_GAP = 1;
const COPY_FEEDBACK_MS = 1_250;
const ATTACHMENT_MENU_ACTIONS: MenuAction[] = [
  { id: 'camera', title: 'الكاميرا', image: 'camera' },
  { id: 'photos', title: 'الصور', image: 'photo' },
  { id: 'files', title: 'الملفات', image: 'paperclip' },
];
const ATTACHMENT_UNAVAILABLE_LABELS: Record<string, string> = {
  camera: 'التقاط صورة بالكاميرا',
  photos: 'اختيار الصور',
  files: 'اختيار الملفات',
};

type DevRecent = {
  id: string;
  title: string;
  timeLabel: string;
  testCase: ChatLayoutTestCase;
};

function hasNativeGlassSupport() {
  try {
    return isGlassEffectAPIAvailable() && isLiquidGlassAvailable();
  } catch {
    return false;
  }
}

export function ChatComposer(props: ChatComposerProps) {
  const { onNewChat, onSelectDevelopmentRecent } = props;
  const { resolvedColorScheme } = usePreferences();
  const palette = getPalette(resolvedColorScheme);
  const pagerRef = useRef<PagerView | null>(null);
  const [activePage, setActivePage] = useState(CHAT_PAGE);
  const [pagerIdle, setPagerIdle] = useState(true);
  const [developmentRecents, setDevelopmentRecents] = useState<readonly DevRecent[]>([]);
  const [glassAvailable] = useState(hasNativeGlassSupport);
  const [reduceTransparency, setReduceTransparency] = useState(false);

  useEffect(() => {
    if (!__DEV__) return;
    let cancelled = false;
    void import('./chat-layout-fixtures.dev').then(({ getAgent1DevelopmentRecents }) => {
      if (!cancelled) setDevelopmentRecents(getAgent1DevelopmentRecents());
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceTransparencyEnabled()
      .then((enabled) => {
        if (mounted) setReduceTransparency(enabled);
      })
      .catch(() => {
        if (mounted) setReduceTransparency(true);
      });
    const subscription = AccessibilityInfo.addEventListener(
      'reduceTransparencyChanged',
      setReduceTransparency,
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  const openRecents = useCallback(() => {
    void KeyboardController.dismiss();
    pagerRef.current?.setPage(0);
  }, []);

  const startNewChat = useCallback(() => {
    onNewChat();
    void KeyboardController.dismiss();
    pagerRef.current?.setPage(CHAT_PAGE);
  }, [onNewChat]);

  const selectDevelopmentRecent = useCallback((testCase: ChatLayoutTestCase) => {
    onSelectDevelopmentRecent(testCase);
    pagerRef.current?.setPage(CHAT_PAGE);
  }, [onSelectDevelopmentRecent]);

  const handlePageSelected = useCallback((event: { nativeEvent: { position: number } }) => {
    const page = event.nativeEvent.position;
    setActivePage(page);
    if (page === 0) void KeyboardController.dismiss();
  }, []);

  return (
    <KeyboardProvider>
      <View style={[styles.root, { backgroundColor: palette.background }]}>
        <PagerView
          ref={pagerRef}
          initialPage={CHAT_PAGE}
          keyboardDismissMode="on-drag"
          onPageSelected={handlePageSelected}
          onPageScrollStateChanged={(event) => setPagerIdle(event.nativeEvent.pageScrollState === 'idle')}
          style={styles.pager}
        >
          <View key="recents" collapsable={false} style={styles.page}>
            <RecentsPage
              rows={developmentRecents}
              isDevelopment={__DEV__}
              glassAvailable={glassAvailable && !reduceTransparency}
              palette={palette}
              colorScheme={resolvedColorScheme}
              onNewChat={startNewChat}
              onSelectRecent={selectDevelopmentRecent}
            />
          </View>
          <View key="chat" collapsable={false} style={styles.page}>
            <Freeze freeze={pagerIdle && activePage !== CHAT_PAGE}>
              <ChatPage
                key={props.newChatKey}
                {...props}
                palette={palette}
                colorScheme={resolvedColorScheme}
                glassAvailable={glassAvailable && !reduceTransparency}
                onOpenRecents={openRecents}
                onStartNewChat={startNewChat}
              />
            </Freeze>
          </View>
        </PagerView>
      </View>
    </KeyboardProvider>
  );
}

const ChatPage = memo(function ChatPage({
  turns,
  onSend,
  onCancel,
  onRegenerate,
  activeTurnId,
  submissionError,
  layoutDiagnosticsEnabled = false,
  palette,
  colorScheme,
  glassAvailable,
  onOpenRecents,
  onStartNewChat,
}: ChatComposerProps & {
  palette: Palette;
  colorScheme: 'light' | 'dark';
  glassAvailable: boolean;
  onOpenRecents: () => void;
  onStartNewChat: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width, height: windowHeight } = useWindowDimensions();
  const rowWidth = Math.max(0, width - insets.left - insets.right);
  const contentWidth = Math.max(0, rowWidth - CHAT_SIDE_INSET * 2);
  const rows = useMemo(() => projectAgent1ChatTurns(turns), [turns]);
  const listRef = useRef<LegendListRef | null>(null);
  const composerRef = useRef<View | null>(null);
  const [followingTail, setFollowingTail] = useState(false);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [composerHeight, setComposerHeight] = useState(0);
  const [anchorIndex, setAnchorIndex] = useState<number | undefined>(undefined);
  const hasOverflowedRef = useRef(false);
  const [draft, setDraft] = useState('');
  const [reactions, setReactions] = useState<Record<string, ChatReaction>>({});
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftInputRef = useRef<TextInput | null>(null);
  const { contentInsetEndAdjustment, onComposerLayout } = useKeyboardChatComposerInset(
    listRef,
    composerRef,
  );
  const { freeze, scrollMessageToEnd } = useKeyboardScrollToEnd({ listRef });

  const reportLayoutDiagnostic = useCallback((
    event: string,
    values: Record<string, string | number | boolean | null>,
  ) => {
    if (!__DEV__ || !layoutDiagnosticsEnabled) return;
    console.info('[Chat layout diagnostics]', { event, ...values });
  }, [layoutDiagnosticsEnabled]);

  useEffect(() => () => {
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
  }, []);

  const handleSend = useCallback(() => {
    const content = draft.trim();
    if (!content || activeTurnId) return;
    const isFirstMessage = turns.length === 0;
    hasOverflowedRef.current = false;
    setFollowingTail(false);
    setAnchorIndex(rows.length);
    const acceptedTurnId = onSend(content);
    if (!acceptedTurnId) {
      setAnchorIndex(undefined);
      return;
    }
    void scrollMessageToEnd({ animated: !isFirstMessage, closeKeyboard: true });
    setDraft('');
  }, [activeTurnId, draft, onSend, rows.length, scrollMessageToEnd, turns.length]);

  const handleCancel = useCallback(() => {
    onCancel();
  }, [onCancel]);

  const handleCopy = useCallback(async (messageId: string, content: string) => {
    try {
      if (!(await Clipboard.setStringAsync(content))) return;
      setCopiedMessageId(messageId);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => {
        setCopiedMessageId((current) => current === messageId ? null : current);
        copyTimeoutRef.current = null;
      }, COPY_FEEDBACK_MS);
    } catch {
      setCopiedMessageId(null);
    }
  }, []);

  const handleShare = useCallback(async (content: string) => {
    if (!content.trim()) return;
    try {
      await Share.share({ message: content });
    } catch {
      Alert.alert('تعذرت المشاركة', 'تعذر فتح قائمة المشاركة. حاول مرة أخرى.');
    }
  }, []);

  const handleReadAloud = useCallback(() => {
    Alert.alert('غير متاح حاليًا', 'القراءة الصوتية غير متاحة حاليًا.');
  }, []);

  const handleAttachmentMenuAction = useCallback(({ nativeEvent }: NativeActionEvent) => {
    const actionLabel = ATTACHMENT_UNAVAILABLE_LABELS[nativeEvent.event];
    if (!actionLabel) return;
    Alert.alert('غير متاح حاليًا', `${actionLabel} غير متاح حاليًا في محادثة Agent 1.`);
  }, []);

  const handleReaction = useCallback((messageId: string, reaction: ChatReaction) => {
    setReactions((current) => {
      const nextReaction = toggleChatReaction(current[messageId], reaction);
      if (!nextReaction) {
        const next = { ...current };
        delete next[messageId];
        return next;
      }
      return { ...current, [messageId]: nextReaction };
    });
    void Haptics.selectionAsync();
  }, []);

  const handleRegenerate = useCallback((turnId: string) => {
    onRegenerate(turnId);
  }, [onRegenerate]);

  const renderRow = useCallback(({ item }: { item: Agent1ChatRenderRow; index: number }) => {
    if (item.kind === 'user') {
      return (
        <UserMessageRow
          message={item.message.content}
          rowWidth={rowWidth}
          contentWidth={contentWidth}
          palette={palette}
        />
      );
    }

    const isLatest = item.turnId === turns[turns.length - 1]?.id;
    const isActive = item.turnId === activeTurnId;
    return (
      <AssistantMessageRow
        key={item.id}
        turn={item.turn}
        isLatest={isLatest}
        isActive={isActive}
        rowWidth={rowWidth}
        contentWidth={contentWidth}
        palette={palette}
        reaction={item.message ? reactions[item.message.id] : undefined}
        copied={item.message?.id === copiedMessageId}
        layoutDiagnosticsEnabled={layoutDiagnosticsEnabled && (isLatest || isActive)}
        onLayoutDiagnostic={reportLayoutDiagnostic}
        onCopy={handleCopy}
        onShare={handleShare}
        onReadAloud={handleReadAloud}
        onReaction={handleReaction}
        onRegenerate={handleRegenerate}
      />
    );
  }, [activeTurnId, contentWidth, copiedMessageId, handleCopy, handleReadAloud, handleReaction, handleRegenerate, handleShare, layoutDiagnosticsEnabled, palette, reactions, reportLayoutDiagnostic, rowWidth, turns]);

  const handleEndVisible = useCallback((visible: boolean) => {
    setShowScrollDown(!visible);
    if (visible && hasOverflowedRef.current) {
      setFollowingTail(true);
    }
  }, []);

  const handleTailSpaceChanged = useCallback((size: number) => {
    if (size <= 0 && !hasOverflowedRef.current) {
      hasOverflowedRef.current = true;
      setFollowingTail(true);
    }
  }, []);

  const handleScrollBeginDrag = useCallback(() => {
    if (hasOverflowedRef.current) {
      setFollowingTail(false);
    }
  }, []);

  const anchoredEndSpace = useMemo(() => {
    if (anchorIndex == null) return undefined;
    return {
      anchorIndex,
      anchorMaxSize: ANCHOR_MAX_SIZE,
      anchorOffset: insets.top + CHAT_TOP_CONTENT_OFFSET,
      onSizeChanged: handleTailSpaceChanged,
    };
  }, [anchorIndex, handleTailSpaceChanged, insets.top]);

  const handleComposerLayout = useCallback((event: LayoutChangeEvent) => {
    setComposerHeight(event.nativeEvent.layout.height);
    onComposerLayout(event);
  }, [onComposerLayout]);

  const keyboardOffset = { opened: insets.bottom };

  return (
    <View style={[styles.chatPage, { backgroundColor: palette.background }]}>
      <KeyboardAwareLegendList<Agent1ChatRenderRow>
        ref={listRef}
        data={rows}
        extraData={{ reactions, copiedMessageId, activeTurnId, submissionError }}
        keyExtractor={(row) => row.id}
        renderItem={renderRow}
        style={styles.transcript}
        contentContainerStyle={[
          styles.transcriptContent,
          {
            paddingTop: insets.top + CHAT_TOP_CONTENT_OFFSET,
          },
        ]}
        applyWorkaroundForContentInsetHitTestBug
        maintainVisibleContentPosition={
          Platform.OS !== 'android' ? undefined : anchorIndex != null && !followingTail
        }
        keyboardLiftBehavior="whenAtEnd"
        contentInsetEndAdjustment={contentInsetEndAdjustment}
        keyboardOffset={insets.bottom}
        freeze={freeze}
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
        anchoredEndSpace={anchoredEndSpace}
        maintainScrollAtEnd={followingTail ? { on: { dataChange: true, itemLayout: true } } : undefined}
        maintainScrollAtEndThreshold={1}
        estimatedItemSize={64}
        estimatedListSize={{ width, height: windowHeight }}
        onEndVisible={handleEndVisible}
        onScrollBeginDrag={handleScrollBeginDrag}
      />

      <ChatHeader
        topInset={insets.top}
        palette={palette}
        colorScheme={colorScheme}
        glassAvailable={glassAvailable}
        onOpenRecents={onOpenRecents}
        onNewChat={onStartNewChat}
      />

      {turns.length === 0 ? (
        <EmptyChatState composerHeight={composerHeight} />
      ) : null}

      {submissionError ? (
        <View style={[styles.submissionError, { bottom: composerHeight + 8 }]}>
          <Text style={[styles.submissionErrorText, { color: palette.textSecondary }]}>
            {submissionError}
          </Text>
        </View>
      ) : null}

      <KeyboardStickyView
        pointerEvents="box-none"
        style={[styles.scrollDown, { bottom: composerHeight + 10 }]}
        offset={keyboardOffset}
      >
        {showScrollDown ? (
          <ScrollToBottomButton
            palette={palette}
            colorScheme={colorScheme}
            glassAvailable={glassAvailable}
            onPress={() => void scrollMessageToEnd({ animated: true, closeKeyboard: false })}
          />
        ) : null}
      </KeyboardStickyView>

      <KeyboardStickyView style={styles.keyboardSticky} offset={keyboardOffset}>
        <View
          ref={composerRef}
          onLayout={handleComposerLayout}
          style={[styles.composerContainer, { paddingBottom: insets.bottom + 8 }]}
        >
          <ComposerInput
            value={draft}
            active={activeTurnId !== null}
            palette={palette}
            glassAvailable={glassAvailable}
            colorScheme={colorScheme}
            inputRef={draftInputRef}
            onChangeText={setDraft}
            onAttachmentMenuAction={handleAttachmentMenuAction}
            onSend={handleSend}
            onCancel={handleCancel}
          />
        </View>
      </KeyboardStickyView>
    </View>
  );
});

const UserMessageRow = memo(function UserMessageRow({
  message,
  rowWidth,
  contentWidth,
  palette,
}: {
  message: string;
  rowWidth: number;
  contentWidth: number;
  palette: Palette;
}) {
  const direction = firstStrongTextDirection(message);
  return (
    <Animated.View
      entering={SlideInDown.easing(Easing.out(Easing.exp)).duration(700).reduceMotion(ReduceMotion.System)}
      style={[styles.userRow, { width: rowWidth }]}
    >
      <View
        style={[
          styles.userBubble,
          {
            backgroundColor: palette.surfaceInset,
            maxWidth: contentWidth * USER_BUBBLE_MAX_WIDTH,
          },
        ]}
      >
        <Text
          selectable
          style={[
            styles.userText,
            {
              color: palette.text,
              textAlign: direction === 'ltr' ? 'left' : 'right',
              writingDirection: direction === 'ltr' ? 'ltr' : 'rtl',
            },
          ]}
        >
          {message}
        </Text>
      </View>
    </Animated.View>
  );
});

const AssistantMessageRow = memo(function AssistantMessageRow({
  turn,
  isLatest,
  isActive,
  rowWidth,
  contentWidth,
  palette,
  reaction,
  copied,
  layoutDiagnosticsEnabled,
  onLayoutDiagnostic,
  onCopy,
  onShare,
  onReadAloud,
  onReaction,
  onRegenerate,
}: {
  turn: ChatTurn;
  isLatest: boolean;
  isActive: boolean;
  rowWidth: number;
  contentWidth: number;
  palette: Palette;
  reaction?: ChatReaction;
  copied: boolean;
  layoutDiagnosticsEnabled: boolean;
  onLayoutDiagnostic: (event: string, values: Record<string, string | number | boolean | null>) => void;
  onCopy: (messageId: string, content: string) => Promise<void>;
  onShare: (content: string) => Promise<void>;
  onReadAloud: () => void;
  onReaction: (messageId: string, reaction: ChatReaction) => void;
  onRegenerate: (turnId: string) => void;
}) {
  const assistant = turn.assistant;
  const policy: Agent1AssistantActionPolicy = getAgent1AssistantActionPolicy(turn, isLatest, isActive);
  const hasBody = Boolean(assistant?.content.length);
  return (
    <View style={[styles.assistantRow, { width: rowWidth }]}>
      {policy.showStatus ? (
        <Animated.View
          entering={FadeIn.delay(450).duration(300).reduceMotion(ReduceMotion.System)}
          style={styles.statusRow}
        >
          <SymbolView name={turn.assistantStatus === 'thinking' ? 'sparkles' : 'text.bubble'} size={15} tintColor={palette.textSecondary} />
          <ChatShimmerText
            text={turn.assistantStatus === 'thinking' ? 'يفكّر...' : 'يعمل...'}
            palette={palette}
          />
        </Animated.View>
      ) : null}

      {hasBody && assistant ? (
        <Agent1EnrichedMarkdown
          messageId={assistant.id}
          content={assistant.content}
          streaming={turn.assistantStatus === 'streaming'}
          contentWidth={contentWidth}
          palette={palette}
          layoutDiagnosticsEnabled={layoutDiagnosticsEnabled}
          onLayoutDiagnostic={onLayoutDiagnostic}
        />
      ) : null}

      {policy.showIncompleteNotice ? (
        <Text style={[styles.noticeText, { color: palette.textSecondary }]}>
          {turn.errorMessage ?? 'انقطع الرد قبل اكتماله.'}
        </Text>
      ) : null}

      {policy.showError ? (
        <Text style={[styles.noticeText, { color: palette.textSecondary }]}>
          {turn.errorMessage}
        </Text>
      ) : null}

      {policy.showFeedback || policy.showRegenerate ? (
        <AssistantActionRow
          turn={turn}
          showFeedback={policy.showFeedback}
          showRegenerate={policy.showRegenerate}
          palette={palette}
          reaction={reaction}
          copied={copied}
          onCopy={onCopy}
          onShare={onShare}
          onReadAloud={onReadAloud}
          onReaction={onReaction}
          onRegenerate={onRegenerate}
        />
      ) : null}

    </View>
  );
});

function AssistantActionRow({
  turn,
  showFeedback,
  showRegenerate,
  palette,
  reaction,
  copied,
  onCopy,
  onShare,
  onReadAloud,
  onReaction,
  onRegenerate,
}: {
  turn: ChatTurn;
  showFeedback: boolean;
  showRegenerate: boolean;
  palette: Palette;
  reaction?: ChatReaction;
  copied: boolean;
  onCopy: (messageId: string, content: string) => Promise<void>;
  onShare: (content: string) => Promise<void>;
  onReadAloud: () => void;
  onReaction: (messageId: string, reaction: ChatReaction) => void;
  onRegenerate: (turnId: string) => void;
}) {
  const assistant = turn.assistant;
  const assistantId = assistant?.id ?? `${turn.id}-assistant-${turn.assistantAttempt}`;
  return (
    <View style={styles.actionRow}>
      {showFeedback ? (
        <>
          <ActionButton
            label={copied ? 'تم نسخ الرد' : 'نسخ الرد'}
            symbol={copied ? 'checkmark' : 'square.on.square'}
            tint={palette.textSecondary}
            onPress={() => void onCopy(assistantId, assistant?.content ?? '')}
          />
          <ActionButton
            label="مشاركة الرد"
            symbol="square.and.arrow.up"
            tint={palette.textSecondary}
            onPress={() => void onShare(assistant?.content ?? '')}
          />
          <ActionButton
            label="قراءة الرد بصوت عالٍ"
            symbol="play"
            tint={palette.textSecondary}
            onPress={onReadAloud}
          />
          <ActionButton
            label={reaction === 'like' ? 'إعجاب محدد' : 'إعجاب'}
            symbol={reaction === 'like' ? 'hand.thumbsup.fill' : 'hand.thumbsup'}
            tint={reaction === 'like' ? palette.text : palette.textSecondary}
            onPress={() => onReaction(assistantId, 'like')}
          />
          <ActionButton
            label={reaction === 'dislike' ? 'عدم إعجاب محدد' : 'عدم إعجاب'}
            symbol={reaction === 'dislike' ? 'hand.thumbsdown.fill' : 'hand.thumbsdown'}
            tint={reaction === 'dislike' ? palette.text : palette.textSecondary}
            onPress={() => onReaction(assistantId, 'dislike')}
          />
        </>
      ) : null}
      {showRegenerate || showFeedback ? (
        <ActionButton
          label={showRegenerate ? 'إعادة إنشاء الرد' : 'إعادة الإنشاء متاحة للرد الأخير فقط'}
          symbol="arrow.clockwise"
          tint={showRegenerate ? palette.textSecondary : palette.textTertiary}
          disabled={!showRegenerate}
          onPress={() => onRegenerate(turn.id)}
        />
      ) : null}
    </View>
  );
}

function ActionButton({
  label,
  symbol,
  tint,
  disabled = false,
  onPress,
}: {
  label: string;
  symbol: SFSymbol;
  tint: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [styles.actionButton, disabled && styles.disabledAction, pressed && styles.pressed]}
      hitSlop={6}
    >
      <SymbolView name={symbol} size={18} tintColor={tint} />
    </Pressable>
  );
}

const ComposerInput = memo(function ComposerInput({
  value,
  active,
  palette,
  glassAvailable,
  colorScheme,
  inputRef,
  onChangeText,
  onAttachmentMenuAction,
  onSend,
  onCancel,
}: {
  value: string;
  active: boolean;
  palette: Palette;
  glassAvailable: boolean;
  colorScheme: 'light' | 'dark';
  inputRef: MutableRefObject<TextInput | null>;
  onChangeText: (value: string) => void;
  onAttachmentMenuAction: (event: NativeActionEvent) => void;
  onSend: () => void;
  onCancel: () => void;
}) {
  const direction = firstStrongTextDirection(value);
  const [oneLineHeight, setOneLineHeight] = useState<number>();
  const onInputLayout = useCallback((event: LayoutChangeEvent) => {
    const measured = Math.round(event.nativeEvent.layout.height);
    setOneLineHeight((current) => current ?? measured);
  }, []);
  const collapsedInputStyle =
    value.length === 0 && oneLineHeight != null ? { height: oneLineHeight } : undefined;

  return (
    <View style={styles.composerRow}>
      <MenuView
        testID="chat-attachment-menu"
        actions={ATTACHMENT_MENU_ACTIONS}
        onPressAction={onAttachmentMenuAction}
      >
        <View
          accessible
          accessibilityRole="button"
          accessibilityLabel="إضافة مرفق"
          accessibilityHint="اختيار الكاميرا أو الصور أو الملفات"
        >
          <GlassSurface
            palette={palette}
            colorScheme={colorScheme}
            glassAvailable={glassAvailable}
            interactive
            style={styles.composerCircle}
          >
            <SymbolView name="plus" size={22} tintColor={palette.text} />
          </GlassSurface>
        </View>
      </MenuView>

      <View style={styles.inputPillWrap}>
        <GlassSurface
          palette={palette}
          colorScheme={colorScheme}
          glassAvailable={glassAvailable}
          style={styles.inputPill}
        >
          <TextInput
            ref={inputRef}
            autoFocus
            value={value}
            onChangeText={onChangeText}
            onLayout={onInputLayout}
            placeholder="اكتب رسالتك..."
            placeholderTextColor={palette.textTertiary}
            multiline
            textAlign={direction === 'ltr' ? 'left' : 'right'}
            returnKeyType="default"
            accessibilityLabel="اكتب رسالتك"
            style={[
              styles.composerInput,
              collapsedInputStyle,
              {
                color: palette.text,
                writingDirection: direction === 'ltr' ? 'ltr' : 'rtl',
              },
            ]}
          />
        </GlassSurface>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={active ? 'إيقاف الرد' : 'إرسال الرسالة'}
        accessibilityState={{ disabled: !active && !value.trim() }}
        disabled={!active && !value.trim()}
        onPress={active ? onCancel : onSend}
        hitSlop={6}
      >
        <GlassSurface
          palette={palette}
          colorScheme={colorScheme}
          glassAvailable={glassAvailable}
          interactive
          style={styles.composerCircle}
        >
          <SymbolView
            name={active ? 'stop.fill' : 'arrow.up'}
            size={active ? 15 : 20}
            tintColor={active || value.trim() ? palette.accentText : palette.textTertiary}
          />
        </GlassSurface>
      </Pressable>
    </View>
  );
});

function ChatHeader({
  topInset,
  palette,
  colorScheme,
  glassAvailable,
  onOpenRecents,
  onNewChat,
}: {
  topInset: number;
  palette: Palette;
  colorScheme: 'light' | 'dark';
  glassAvailable: boolean;
  onOpenRecents: () => void;
  onNewChat: () => void;
}) {
  return (
    <View style={[styles.header, { backgroundColor: palette.background, paddingTop: topInset + HEADER_TOP_GAP }]}>
      <IconButton
        label="فتح المحادثات الأخيرة"
        symbol="line.3.horizontal"
        palette={palette}
        colorScheme={colorScheme}
        glassAvailable={glassAvailable}
        onPress={onOpenRecents}
      />
      <GlassSurface
        palette={palette}
        colorScheme={colorScheme}
        glassAvailable={glassAvailable}
        interactive
        style={styles.headerTitlePill}
      >
        <Text style={[styles.headerTitle, { color: palette.text }]}>Pythagoras</Text>
        <SymbolView name="chevron.down" size={13} tintColor={palette.textSecondary} />
      </GlassSurface>
      <IconButton
        label="محادثة جديدة"
        symbol="square.and.pencil"
        palette={palette}
        colorScheme={colorScheme}
        glassAvailable={glassAvailable}
        onPress={onNewChat}
      />
    </View>
  );
}

function RecentsPage({
  rows,
  isDevelopment,
  glassAvailable,
  palette,
  colorScheme,
  onNewChat,
  onSelectRecent,
}: {
  rows: readonly DevRecent[];
  isDevelopment: boolean;
  glassAvailable: boolean;
  palette: Palette;
  colorScheme: 'light' | 'dark';
  onNewChat: () => void;
  onSelectRecent: (testCase: ChatLayoutTestCase) => void;
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const renderRecent = useCallback(({ item }: LegendListRenderItemProps<DevRecent>) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={isDevelopment ? `فتح عينة تطويرية: ${item.title}` : item.title}
      onPress={() => onSelectRecent(item.testCase)}
      style={({ pressed }) => [styles.recentRow, pressed && styles.recentRowPressed]}
    >
      <View style={styles.recentCopy}>
        <Text style={[styles.recentTitle, { color: palette.text }]} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={[styles.recentTime, { color: palette.textSecondary }]}>{item.timeLabel}</Text>
      </View>
    </Pressable>
  ), [isDevelopment, onSelectRecent, palette.text, palette.textSecondary]);
  const listHeader = (
    <View>
      <Text style={[styles.historyTitle, { color: palette.textSecondary }]}>السجل</Text>
    </View>
  );

  return (
    <View style={[styles.recentsPage, { backgroundColor: palette.background }]}>
      <View style={[styles.recentsTopRow, { paddingTop: insets.top + 8 }]}>
        <View style={[styles.searchField, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <SymbolView name="magnifyingglass" size={18} tintColor={palette.textSecondary} />
          <TextInput
            placeholder="بحث"
            placeholderTextColor={palette.textSecondary}
            accessibilityLabel="البحث في المحادثات"
            style={[styles.searchInput, { color: palette.text }]}
          />
        </View>
      </View>

      <LegendList<DevRecent>
        data={rows}
        style={styles.recentsList}
        keyExtractor={(item) => item.id}
        renderItem={renderRecent}
        estimatedItemSize={66}
        recycleItems
        ListHeaderComponent={listHeader}
        ListEmptyComponent={(
          <Text style={[styles.recentsEmptyTitle, { color: palette.textSecondary }]}>
            لا توجد محادثات محفوظة بعد.
          </Text>
        )}
        contentContainerStyle={styles.recentsListContent}
        showsVerticalScrollIndicator={false}
      />

      <View style={[styles.recentsFooter, { paddingBottom: insets.bottom + 8 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="بدء محادثة جديدة"
          onPress={onNewChat}
          hitSlop={8}
          style={styles.newChatWrap}
        >
          <GlassSurface
            palette={palette}
            colorScheme={colorScheme}
            glassAvailable={glassAvailable}
            interactive
            style={styles.newChatButton}
          >
            <SymbolView name="plus" size={16} tintColor={palette.text} />
            <Text style={[styles.newChatButtonText, { color: palette.text }]}>محادثة جديدة</Text>
          </GlassSurface>
        </Pressable>
        <IconButton
          label="الإعدادات"
          symbol="gearshape"
          palette={palette}
          colorScheme={colorScheme}
          glassAvailable={glassAvailable}
          onPress={() => router.push('/settings')}
        />
      </View>
    </View>
  );
}

function IconButton({
  label,
  symbol,
  palette,
  colorScheme,
  glassAvailable,
  onPress,
}: {
  label: string;
  symbol: SFSymbol;
  palette: Palette;
  colorScheme: 'light' | 'dark';
  glassAvailable: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.headerButtonPressable, pressed && styles.pressed]}
    >
      <GlassSurface
        palette={palette}
        colorScheme={colorScheme}
        glassAvailable={glassAvailable}
        interactive
        style={styles.headerButton}
      >
      <SymbolView name={symbol} size={20} tintColor={palette.text} />
      </GlassSurface>
    </Pressable>
  );
}

function ScrollToBottomButton({
  palette,
  colorScheme,
  glassAvailable,
  onPress,
}: {
  palette: Palette;
  colorScheme: 'light' | 'dark';
  glassAvailable: boolean;
  onPress: () => void;
}) {
  return (
    <Animated.View
      entering={ZoomIn.duration(160).reduceMotion(ReduceMotion.System)}
      exiting={ZoomOut.duration(140).reduceMotion(ReduceMotion.System)}
    >
      <Pressable onPress={onPress} hitSlop={10} accessibilityRole="button" accessibilityLabel="الانتقال إلى أحدث رسالة">
        <GlassSurface
          palette={palette}
          colorScheme={colorScheme}
          glassAvailable={glassAvailable}
          interactive
          style={styles.scrollButton}
        >
          <SymbolView name="chevron.down" size={18} tintColor={palette.text} />
        </GlassSurface>
      </Pressable>
    </Animated.View>
  );
}

function GlassSurface({
  palette,
  colorScheme,
  glassAvailable,
  interactive = false,
  style,
  children,
}: {
  palette: Palette;
  colorScheme: 'light' | 'dark';
  glassAvailable: boolean;
  interactive?: boolean;
  style: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  if (glassAvailable) {
    return (
      <GlassView
        glassEffectStyle="regular"
        isInteractive={interactive}
        tintColor={palette.surfaceElevated}
        colorScheme={colorScheme}
        style={style}
      >
        {children}
      </GlassView>
    );
  }
  return (
    <View style={[style, { backgroundColor: palette.surfaceElevated }]}>
      {children}
    </View>
  );
}

function EmptyChatState({ composerHeight }: { composerHeight: number }) {
  const { progress } = useReanimatedKeyboardAnimation();
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: progress.value * -(composerHeight + EMPTY_STATE_LOGO_GAP) }],
  }), [composerHeight]);
  return (
    <Animated.View pointerEvents="none" style={[styles.emptyState, animatedStyle]}>
      <Animated.Image
        source={require('../../assets/images/android-icon-monochrome.png')}
        resizeMode="contain"
        style={styles.brandMark}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  pager: { flex: 1 },
  page: { flex: 1 },
  chatPage: { flex: 1 },
  transcript: { flex: 1 },
  transcriptContent: { flexGrow: 1, paddingBottom: 4 },
  header: {
    position: 'absolute',
    zIndex: 5,
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: HEADER_SIDE_INSET,
    paddingBottom: 8,
  },
  headerButtonPressable: {
    width: HEADER_BUTTON_SIZE,
    height: HEADER_BUTTON_SIZE,
  },
  headerButton: {
    alignItems: 'center',
    justifyContent: 'center',
    width: HEADER_BUTTON_SIZE,
    height: HEADER_BUTTON_SIZE,
    borderRadius: HEADER_BUTTON_SIZE / 2,
  },
  headerTitlePill: {
    height: HEADER_BUTTON_SIZE,
    paddingHorizontal: 18,
    borderRadius: HEADER_BUTTON_SIZE / 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    overflow: 'hidden',
  },
  headerTitle: { fontSize: 17, fontWeight: '600' },
  pressed: { opacity: 0.72 },
  userRow: { alignSelf: 'stretch', alignItems: 'flex-end', paddingHorizontal: 16, paddingVertical: 4 },
  userBubble: {
    alignSelf: 'flex-end',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: USER_BUBBLE_RADIUS,
  },
  userText: { fontSize: 16, lineHeight: USER_LINE_HEIGHT },
  assistantRow: { alignSelf: 'stretch', paddingHorizontal: 16, paddingVertical: 4 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  noticeText: { fontSize: 14, lineHeight: 20, marginTop: 8 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 22, alignSelf: 'flex-start', paddingTop: 10, paddingBottom: 2 },
  actionButton: { width: 18, height: 22, alignItems: 'center', justifyContent: 'center' },
  disabledAction: { opacity: 0.45 },
  keyboardSticky: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 8 },
  composerContainer: { paddingHorizontal: 12, paddingTop: 8 },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  composerCircle: { width: COMPOSER_CIRCLE_SIZE, height: COMPOSER_CIRCLE_SIZE, borderRadius: COMPOSER_CIRCLE_SIZE / 2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  inputPillWrap: { flex: 1 },
  inputPill: { minHeight: COMPOSER_CIRCLE_SIZE, borderRadius: 24, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 6, overflow: 'hidden' },
  composerInput: {
    maxHeight: COMPOSER_INPUT_MAX_HEIGHT,
    paddingVertical: 4,
    fontSize: 16,
  },
  submissionError: { position: 'absolute', left: 20, right: 20, zIndex: 4, alignItems: 'center' },
  submissionErrorText: { fontSize: 13, textAlign: 'center', lineHeight: 19 },
  emptyState: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1, alignItems: 'center', justifyContent: 'center' },
  brandMark: { width: 36, height: 36, opacity: 0.2 },
  scrollDown: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 7 },
  scrollButton: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  recentsPage: { flex: 1 },
  recentsTopRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 12 },
  searchField: { flex: 1, height: 44, borderRadius: 22, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { flex: 1, fontSize: 17, textAlign: 'right', writingDirection: 'rtl', padding: 0 },
  recentsList: { flex: 1 },
  recentsListContent: { flexGrow: 1, paddingBottom: 12 },
  historyTitle: { fontSize: 16, fontWeight: '500', textAlign: 'right', paddingHorizontal: 20, paddingTop: 6, paddingBottom: 8 },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 12 },
  recentRowPressed: { opacity: 0.62 },
  recentCopy: { flex: 1, gap: 3 },
  recentTitle: { fontSize: 18, fontWeight: '600', textAlign: 'right', writingDirection: 'rtl' },
  recentTime: { fontSize: 15, textAlign: 'right', writingDirection: 'rtl' },
  recentsEmptyTitle: { fontSize: 15, textAlign: 'center' },
  recentsFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8, gap: 10 },
  newChatWrap: { flex: 1 },
  newChatButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 44, borderRadius: 22, overflow: 'hidden' },
  newChatButtonText: { fontSize: 17, fontWeight: '600' },
});

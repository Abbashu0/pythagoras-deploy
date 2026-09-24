import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Keyboard, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Stack } from 'expo-router/stack';
import * as Haptics from 'expo-haptics';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';
import ReanimatedDrawerLayout, {
  DrawerKeyboardDismissMode,
  DrawerPosition,
  DrawerType,
  type DrawerLayoutMethods,
} from 'react-native-gesture-handler/ReanimatedDrawerLayout';

import { ChatComposer } from '@/ai/chat-composer';
import { Agent1ChatApiError, clearAgent1DevPairing, hasAgent1DevPairing, sendAgent1DevChat } from '@/ai/agent-1-chat-api';
import { DevChatPairingModal } from '@/ai/dev-chat-pairing-modal';
import { MAX_TEMP_CHAT_MESSAGES, type ChatMessage } from '@/ai/chat-types';
import { ChatTopControls } from '@/ai/chat-top-controls';
import { usePreferences } from '@/preferences/preferences-provider';
import { getPalette } from '@/theme';

export default function ChatScreen() {
  const { resolvedColorScheme } = usePreferences();
  const palette = getPalette(resolvedColorScheme);
  const { width } = useWindowDimensions();
  const router = useRouter();
  const drawerRef = useRef<DrawerLayoutMethods | null>(null);
  const drawerOpenRef = useRef(false);
  const activeRequestRef = useRef<AbortController | null>(null);
  const messageSequenceRef = useRef(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [pairingVisible, setPairingVisible] = useState(false);
  const renderNavigationView = useCallback(
    () => <View style={[styles.sidebar, { backgroundColor: palette.surface }]} />,
    [palette.surface],
  );
  const handleDrawerOpen = useCallback(() => {
    if (drawerOpenRef.current) return;
    drawerOpenRef.current = true;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
  }, []);
  const handleDrawerClose = useCallback(() => {
    if (!drawerOpenRef.current) return;
    drawerOpenRef.current = false;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
  }, []);
  const handleMenuPress = useCallback(() => {
    // Expo UI's keyboard host forwards this blur request to the focused SwiftUI TextFieldRef.
    Keyboard.dismiss();
    drawerRef.current?.openDrawer();
  }, []);
  const handleSend = useCallback(async (draft: string): Promise<boolean> => {
    const content = draft.trim();
    if (!content || activeRequestRef.current) return false;
    if (!__DEV__ || process.env.EXPO_OS !== 'ios') {
      setSendError('محادثة Agent 1 متاحة حاليًا في بيئة التطوير على iPhone فقط.');
      return false;
    }
    if (!hasAgent1DevPairing()) {
      setPairingVisible(true);
      setSendError(null);
      return false;
    }
    if (messages.length >= MAX_TEMP_CHAT_MESSAGES) {
      setSendError('انتهت سعة جلسة المحادثة المؤقتة. اخرج من الشات وارجع لبدء جلسة جديدة.');
      return false;
    }

    const requestController = new AbortController();
    const userMessage: ChatMessage = {
      id: `chat-${Date.now()}-${messageSequenceRef.current++}`,
      role: 'user',
      content,
    };
    const requestMessages = [
      ...messages.map(({ role, content: previousContent }) => ({
        role,
        content: previousContent,
      })),
      { role: 'user' as const, content },
    ];

    activeRequestRef.current = requestController;
    setSendError(null);
    setSending(true);
    setMessages((current) => [...current, userMessage]);
    try {
      const reply = await sendAgent1DevChat(requestMessages, requestController.signal);
      if (requestController.signal.aborted) return false;
      setMessages((current) => [
        ...current,
        {
          id: `chat-${Date.now()}-${messageSequenceRef.current++}`,
          role: 'assistant',
          content: reply,
        },
      ]);
      return true;
    } catch (error) {
      if (requestController.signal.aborted) return false;
      setMessages((current) => current.filter((message) => message.id !== userMessage.id));
      if (error instanceof Agent1ChatApiError && error.code === 'PAIRING_REQUIRED') {
        setPairingVisible(true);
        setSendError(null);
      } else {
        setSendError(agent1ChatErrorMessage(error));
      }
      return false;
    } finally {
      if (activeRequestRef.current === requestController) {
        activeRequestRef.current = null;
        setSending(false);
      }
    }
  }, [messages]);

  useEffect(() => () => {
    activeRequestRef.current?.abort();
    clearAgent1DevPairing();
  }, []);

  return (
    <>
      {process.env.EXPO_OS !== 'ios' ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            accessibilityLabel="فتح القائمة"
            icon="line.3.horizontal"
            onPress={handleMenuPress}
            separateBackground
            tintColor={palette.text}
          />
        </Stack.Toolbar>
      ) : null}
      <ReanimatedDrawerLayout
        ref={drawerRef}
        drawerPosition={DrawerPosition.RIGHT}
        drawerType={DrawerType.BACK}
        drawerWidth={width * 0.72}
        edgeWidth={Math.min(width, 64)}
        minSwipeDistance={10}
        drawerBackgroundColor={palette.surface}
        renderNavigationView={renderNavigationView}
        contentContainerStyle={[
          styles.drawerForegroundClip,
          { backgroundColor: palette.background },
        ]}
        overlayColor="transparent"
        keyboardDismissMode={DrawerKeyboardDismissMode.ON_DRAG}
        hideStatusBar={false}
        onDrawerOpen={handleDrawerOpen}
        onDrawerClose={handleDrawerClose}
      >
        {(drawerProgress) => (
          <ChatDrawerForeground
            drawerProgress={drawerProgress}
          >
            <ChatComposer
              messages={messages}
              onSend={handleSend}
              sending={sending}
              errorMessage={sendError}
            />
            {process.env.EXPO_OS === 'ios' ? (
              <ChatTopControls
                colorScheme={resolvedColorScheme}
                foregroundColor={palette.text}
                onBack={() => router.back()}
                onMenu={handleMenuPress}
              />
            ) : null}
          </ChatDrawerForeground>
        )}
      </ReanimatedDrawerLayout>
      <StatusBar style={resolvedColorScheme === 'dark' ? 'light' : 'dark'} />
      {__DEV__ && process.env.EXPO_OS === 'ios' ? (
        <DevChatPairingModal
          visible={pairingVisible}
          colorScheme={resolvedColorScheme}
          onDismiss={() => setPairingVisible(false)}
          onPaired={() => {
            setPairingVisible(false);
            setSendError(null);
          }}
        />
      ) : null}
    </>
  );
}

function agent1ChatErrorMessage(error: unknown): string {
  if (!(error instanceof Agent1ChatApiError)) {
    return 'تعذر الاتصال بخادم التطوير. تحقق من اتصال iPhone بالشبكة المحلية.';
  }
  if (error.code === 'AGENT_1_DISABLED') {
    return 'Agent 1 متوقف. شغّله من صفحة التشغيل في لوحة الإدارة.';
  }
  if (error.code === 'AGENT_1_NOT_READY') {
    return 'النموذج الرئيسي غير جاهز. راجع إعداد Agent 1 والمزوّد في لوحة الإدارة.';
  }
  if (error.code === 'CHAT_TOO_LARGE' || error.code === 'CHAT_INVALID') {
    return 'تعذر إرسال هذا الطلب ضمن حدود جلسة التطوير المؤقتة.';
  }
  if (error.code === 'NETWORK_UNAVAILABLE') {
    return 'تعذر الوصول إلى خادم التطوير. تحقق من الشبكة المحلية وعنوان الخادم.';
  }
  return 'تعذر الحصول على رد من Agent 1. راجع جاهزية المزوّد وحاول مجددًا.';
}

function ChatDrawerForeground({
  drawerProgress,
  children,
}: {
  drawerProgress?: SharedValue<number>;
  children: ReactNode;
}) {
  const animatedScrim = useAnimatedStyle(
    () => ({
      opacity: interpolate(
        drawerProgress?.value ?? 0,
        [0, 1],
        [0, 1],
        Extrapolation.CLAMP,
      ),
    }),
    [drawerProgress],
  );

  return (
    <Animated.View
      style={styles.container}
    >
      {children}
      <Animated.View
        pointerEvents="none"
        style={[styles.foregroundScrim, animatedScrim]}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  drawerForegroundClip: {
    overflow: 'hidden',
    borderCurve: 'continuous',
    borderRadius: 32,
  },
  foregroundScrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.06)',
  },
  sidebar: {
    flex: 1,
    direction: 'rtl',
  },
});

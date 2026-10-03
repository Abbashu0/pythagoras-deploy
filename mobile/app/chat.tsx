import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { ChatComposer } from '@/ai/chat-composer';
import { Agent1ChatApiError, sendAgent1DevChat } from '@/ai/agent-1-chat-api';
import {
  Agent1ChatRequestCoordinator,
  applyAgent1ChatStreamEvent,
  buildAgent1HistoryForNewTurn,
  buildAgent1HistoryForRegenerate,
  canRegenerateAgent1Turn,
  createAcceptedAgent1ChatTurn,
  failAgent1ChatTurn,
  resetAgent1ChatTurnAttempt,
} from '@/ai/agent-1-chat-state';
import {
  MAX_TEMP_CHAT_MESSAGES,
  type ChatLayoutTestCase,
  type ChatMessage,
  type ChatTurn,
} from '@/ai/chat-types';
import { usePreferences } from '@/preferences/preferences-provider';

const CHAT_LAYOUT_TEST_CASES: readonly ChatLayoutTestCase[] = [
  'short',
  'biology',
  'math',
  'table',
  'scroll',
  'stream',
];

export default function ChatScreen() {
  const { resolvedColorScheme } = usePreferences();
  const router = useRouter();
  const { layoutTest, layoutDiagnostics } = useLocalSearchParams<{
    layoutTest?: string;
    layoutDiagnostics?: string;
  }>();
  const isDevelopmentLayoutTest =
    __DEV__ &&
    process.env.EXPO_OS === 'ios' &&
    CHAT_LAYOUT_TEST_CASES.some((testCase) => testCase === layoutTest);
  const layoutTestCase = isDevelopmentLayoutTest ? layoutTest as ChatLayoutTestCase : null;
  const layoutDiagnosticsEnabled =
    __DEV__ &&
    process.env.EXPO_OS === 'ios' &&
    (isDevelopmentLayoutTest || layoutDiagnostics === '1');

  const [requestCoordinator] = useState(() => new Agent1ChatRequestCoordinator());
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const turnsRef = useRef<ChatTurn[]>([]);
  const mountedRef = useRef(false);
  const activeTurnIdRef = useRef<string | null>(null);
  const regenerationInProgressRef = useRef(false);
  const messageSequenceRef = useRef(0);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [newChatKey, setNewChatKey] = useState(0);

  const updateTurns = useCallback((update: (current: readonly ChatTurn[]) => ChatTurn[]) => {
    const next = update(turnsRef.current);
    turnsRef.current = next;
    setTurns(next);
  }, []);

  const updateActiveTurn = useCallback((turnId: string | null) => {
    activeTurnIdRef.current = turnId;
    setActiveTurnId(turnId);
  }, []);

  useEffect(() => {
    if (!layoutTestCase || requestCoordinator.isBusy) return;
    let cancelled = false;
    let stopFixtureStream = () => {};

    void import('@/ai/chat-layout-fixtures.dev')
      .then(({ createChatLayoutTestTurn, getChatLayoutStreamChunks }) => {
        if (cancelled) return;
        const turn = createChatLayoutTestTurn(layoutTestCase);
        updateTurns(() => [turn]);
        if (layoutTestCase !== 'stream') {
          updateActiveTurn(null);
          return;
        }

        updateActiveTurn(turn.id);
        updateTurns((current) =>
          applyAgent1ChatStreamEvent(current, turn.id, { type: 'started' }),
        );

        let streamCancelled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        let releasePendingDelay = () => {};
        const runFixtureStream = async () => {
          updateTurns((current) =>
            applyAgent1ChatStreamEvent(current, turn.id, { type: 'phase', phase: 'thinking' }),
          );

          for (const chunk of getChatLayoutStreamChunks()) {
            await new Promise<void>((resolve) => {
              let settled = false;
              const finish = () => {
                if (settled) return;
                settled = true;
                timer = null;
                resolve();
              };
              timer = setTimeout(finish, 180);
              releasePendingDelay = () => {
                if (timer !== null) clearTimeout(timer);
                finish();
              };
            });
            if (cancelled || streamCancelled) return;
            updateTurns((current) =>
              applyAgent1ChatStreamEvent(current, turn.id, { type: 'text_delta', text: chunk }),
            );
          }

          if (cancelled || streamCancelled) return;
          updateTurns((current) =>
            applyAgent1ChatStreamEvent(current, turn.id, { type: 'completed' }),
          );
          updateActiveTurn(null);
        };

        void runFixtureStream();
        stopFixtureStream = () => {
          streamCancelled = true;
          releasePendingDelay();
        };
      })
      .catch(() => {
        if (!cancelled) setSubmissionError('تعذر تحميل بيانات اختبار التخطيط التطويري.');
      });

    return () => {
      cancelled = true;
      stopFixtureStream();
    };
  }, [layoutTestCase, requestCoordinator, updateActiveTurn, updateTurns]);

  const executeAssistantTurn = useCallback(async (
    turnId: string,
    requestMessages: readonly Pick<ChatMessage, 'role' | 'content'>[],
    signal: AbortSignal,
    generation: number,
  ) => {
    let receivedTextCharacters = 0;
    try {
      await sendAgent1DevChat(requestMessages, signal, (event) => {
        if (!requestCoordinator.isCurrent(generation)) return;
        if (event.type === 'text_delta') receivedTextCharacters += event.text.length;
        updateTurns((current) => applyAgent1ChatStreamEvent(current, turnId, event));
      });
      if (__DEV__) {
        console.info('[Agent1 chat diagnostics] stream completed', {
          turnId,
          receivedTextCharacters,
        });
      }
    } catch (error) {
      if (signal.aborted || !requestCoordinator.isCurrent(generation)) return;
      if (__DEV__) {
        console.info('[Agent1 chat diagnostics] stream failed', {
          turnId,
          errorCode:
            error instanceof Agent1ChatApiError
              ? error.code
              : error instanceof Error
                ? error.name
                : 'UNKNOWN',
          receivedTextCharacters,
        });
      }
      updateTurns((current) =>
        failAgent1ChatTurn(current, turnId, agent1ChatErrorMessage(error)),
      );
    } finally {
      if (
        requestCoordinator.isCurrent(generation) &&
        activeTurnIdRef.current === turnId
      ) {
        updateActiveTurn(null);
      }
    }
  }, [requestCoordinator, updateActiveTurn, updateTurns]);

  const handleSend = useCallback((draft: string): string | null => {
    const content = draft.trim();
    if (!content || requestCoordinator.isBusy || regenerationInProgressRef.current) return null;
    if (!__DEV__ || process.env.EXPO_OS !== 'ios') {
      setSubmissionError('محادثة Agent 1 متاحة حاليًا في بيئة التطوير على iPhone فقط.');
      return null;
    }

    const currentTurns = turnsRef.current;
    const currentMessageCount = currentTurns.reduce(
      (count, turn) => count + 1 + (turn.assistant ? 1 : 0),
      0,
    );
    if (currentMessageCount >= MAX_TEMP_CHAT_MESSAGES) {
      setSubmissionError('انتهت سعة جلسة المحادثة المؤقتة. ابدأ محادثة جديدة للمتابعة.');
      return null;
    }

    const turnId = `turn-${Date.now()}-${messageSequenceRef.current++}`;
    const turn = createAcceptedAgent1ChatTurn(turnId, content);
    const requestMessages = buildAgent1HistoryForNewTurn(currentTurns, turn.user);

    setSubmissionError(null);
    updateTurns((current) => [...current, turn]);
    updateActiveTurn(turnId);
    const started = requestCoordinator.start((signal, generation) =>
      executeAssistantTurn(turnId, requestMessages, signal, generation),
    );
    if (!started) {
      updateTurns((current) => current.filter((candidate) => candidate.id !== turnId));
      updateActiveTurn(null);
      setSubmissionError('تعذر بدء طلب جديد أثناء معالجة الطلب السابق. حاول مجددًا.');
      return null;
    }
    return turnId;
  }, [executeAssistantTurn, requestCoordinator, updateActiveTurn, updateTurns]);

  const handleCancel = useCallback(() => {
    const turnId = activeTurnIdRef.current;
    if (!turnId) return;
    requestCoordinator.cancelAll();
    updateTurns((current) => failAgent1ChatTurn(current, turnId, 'تم إيقاف الرد.'));
    updateActiveTurn(null);
  }, [requestCoordinator, updateActiveTurn, updateTurns]);

  const handleRegenerate = useCallback((turnId: string) => {
    if (regenerationInProgressRef.current) return;
    const currentTurns = turnsRef.current;
    if (!canRegenerateAgent1Turn(currentTurns, turnId, activeTurnIdRef.current)) return;
    const requestMessages = buildAgent1HistoryForRegenerate(currentTurns, turnId);
    if (!requestMessages) return;

    regenerationInProgressRef.current = true;
    setSubmissionError(null);
    updateActiveTurn(turnId);
    const replacement = requestCoordinator.replace((signal, generation) =>
      executeAssistantTurn(turnId, requestMessages, signal, generation),
    );
    updateTurns((current) => resetAgent1ChatTurnAttempt(current, turnId));
    void replacement.finally(() => {
      regenerationInProgressRef.current = false;
      if (
        mountedRef.current &&
        !requestCoordinator.isBusy &&
        activeTurnIdRef.current === turnId
      ) {
        updateActiveTurn(null);
      }
    });
  }, [executeAssistantTurn, requestCoordinator, updateActiveTurn, updateTurns]);

  const handleNewChat = useCallback(() => {
    requestCoordinator.cancelAll();
    updateTurns(() => []);
    updateActiveTurn(null);
    setSubmissionError(null);
    setNewChatKey((key) => key + 1);
    router.setParams({ layoutTest: undefined, layoutDiagnostics: undefined });
  }, [requestCoordinator, router, updateActiveTurn, updateTurns]);

  const handleSelectDevelopmentRecent = useCallback((testCase: ChatLayoutTestCase) => {
    if (requestCoordinator.isBusy) {
      setSubmissionError('أوقف الرد الحالي قبل فتح حالة الاختبار.');
      return;
    }
    setSubmissionError(null);
    router.setParams({ layoutTest: testCase, layoutDiagnostics: '1' });
  }, [requestCoordinator, router]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestCoordinator.cancelAll();
    };
  }, [requestCoordinator]);

  return (
    <>
      <ChatComposer
        turns={turns}
        onSend={handleSend}
        onCancel={handleCancel}
        onRegenerate={handleRegenerate}
        onNewChat={handleNewChat}
        onSelectDevelopmentRecent={handleSelectDevelopmentRecent}
        newChatKey={newChatKey}
        activeTurnId={activeTurnId}
        submissionError={submissionError}
        layoutDiagnosticsEnabled={layoutDiagnosticsEnabled}
      />
      <StatusBar style={resolvedColorScheme === 'dark' ? 'light' : 'dark'} />
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

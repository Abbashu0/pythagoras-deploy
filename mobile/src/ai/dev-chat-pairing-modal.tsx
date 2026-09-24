import { useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  Agent1ChatApiError,
  clearAgent1DevPairing,
  pairAgent1DevChat,
} from "@/ai/agent-1-chat-api";
import { getPalette } from "@/theme";
import type { ResolvedColorScheme } from "@/preferences/preferences-provider";

export function DevChatPairingModal({
  visible,
  colorScheme,
  onDismiss,
  onPaired,
}: {
  visible: boolean;
  colorScheme: ResolvedColorScheme;
  onDismiss: () => void;
  onPaired: () => void;
}) {
  const palette = getPalette(colorScheme);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const pairingRequestRef = useRef<AbortController | null>(null);

  const dismiss = () => {
    pairingRequestRef.current?.abort();
    pairingRequestRef.current = null;
    clearAgent1DevPairing();
    setCode("");
    setError(null);
    setSubmitting(false);
    onDismiss();
  };

  const submit = async () => {
    if (!/^[a-f0-9]{20}$/iu.test(code.trim())) {
      setError("أدخل رمز الاقتران الكامل من صفحة تشغيل Agent 1.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const requestController = new AbortController();
    pairingRequestRef.current = requestController;
    try {
      await pairAgent1DevChat(code, requestController.signal);
      setCode("");
      onPaired();
    } catch (requestError) {
      if (requestController.signal.aborted) return;
      const code = requestError instanceof Agent1ChatApiError
        ? requestError.code
        : "PAIRING_FAILED";
      setError(
        code === "PAIRING_CODE_INVALID"
          ? "الرمز غير صالح أو انتهت صلاحيته. أنشئ رمزًا جديدًا من لوحة الإدارة."
          : code === "PAIRING_RATE_LIMITED"
            ? "محاولات كثيرة خلال وقت قصير. انتظر قليلًا ثم جرّب مجددًا."
          : "تعذر الاقتران بالخادم المحلي. تحقق من الشبكة وحاول مجددًا.",
      );
    } finally {
      if (pairingRequestRef.current === requestController) {
        pairingRequestRef.current = null;
        setSubmitting(false);
      }
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      presentationStyle="overFullScreen"
      onRequestClose={dismiss}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.keyboardLayer}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="إغلاق نافذة الاقتران"
          onPress={dismiss}
          style={styles.scrim}
        />
        <View
          accessibilityViewIsModal
          style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}
        >
          <Text style={[styles.title, { color: palette.text }]}>اقتران تطويري</Text>
          <Text style={[styles.description, { color: palette.textSecondary }]}>
            أنشئ رمزًا مؤقتًا من صفحة تشغيل Agent 1 في لوحة الإدارة، ثم أدخله هنا. الرمز صالح لدقيقتين ويُستخدم مرة واحدة.
          </Text>
          <TextInput
            accessibilityLabel="رمز اقتران Agent 1"
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!submitting}
            maxLength={20}
            onChangeText={(value) => {
              setCode(value.replace(/[^a-f0-9]/giu, "").toUpperCase());
              setError(null);
            }}
            onSubmitEditing={() => void submit()}
            placeholder="20 رمزًا سداسيًا"
            placeholderTextColor={palette.textTertiary}
            returnKeyType="done"
            spellCheck={false}
            style={[
              styles.codeField,
              {
                backgroundColor: palette.surfaceInset,
                borderColor: palette.border,
                color: palette.text,
              },
            ]}
            textAlign="center"
            value={code}
          />
          {error ? (
            <Text accessibilityRole="alert" style={[styles.error, { color: palette.textSecondary }]}>
              {error}
            </Text>
          ) : null}
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              onPress={dismiss}
              style={[styles.secondaryButton, { borderColor: palette.border }]}
            >
              <Text style={[styles.secondaryLabel, { color: palette.text }]}>إلغاء</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: submitting || code.length !== 20 }}
              disabled={submitting || code.length !== 20}
              onPress={() => void submit()}
              style={[
                styles.primaryButton,
                { backgroundColor: palette.strongButton },
                submitting || code.length !== 20 ? styles.disabledButton : null,
              ]}
            >
              {submitting ? (
                <ActivityIndicator color={palette.strongButtonText} />
              ) : (
                <Text style={[styles.primaryLabel, { color: palette.strongButtonText }]}>ربط الجهاز</Text>
              )}
            </Pressable>
          </View>
          <Text style={[styles.footnote, { color: palette.textTertiary }]}>
            وضع تطوير محلي فقط؛ لا تستخدمه على شبكة عامة. نص الرسائل يُرسل إلى المزوّد المحدد وقد يخضع لسياسة الاحتفاظ لديه.
          </Text>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  keyboardLayer: {
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0, 0, 0, 0.52)",
  },
  card: {
    alignSelf: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 24,
    padding: 20,
    width: "100%",
    maxWidth: 460,
    gap: 14,
  },
  title: {
    fontSize: 20,
    fontWeight: "600",
    textAlign: "right",
  },
  description: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: "right",
  },
  codeField: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    minHeight: 50,
    paddingHorizontal: 12,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
    fontSize: 17,
    letterSpacing: 1.5,
  },
  error: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: "right",
  },
  actions: {
    flexDirection: "row-reverse",
    gap: 10,
    marginTop: 2,
  },
  primaryButton: {
    alignItems: "center",
    borderRadius: 15,
    flex: 1,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 16,
  },
  secondaryButton: {
    alignItems: "center",
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
    minHeight: 48,
    minWidth: 84,
    paddingHorizontal: 14,
  },
  primaryLabel: {
    fontSize: 16,
    fontWeight: "600",
  },
  secondaryLabel: {
    fontSize: 15,
    fontWeight: "500",
  },
  disabledButton: {
    opacity: 0.48,
  },
  footnote: {
    fontSize: 12,
    lineHeight: 18,
    textAlign: "right",
  },
});

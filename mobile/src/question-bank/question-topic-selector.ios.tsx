import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from 'expo-glass-effect';
import { Button, HStack, Host, Image, Popover, Text, VStack } from '@expo/ui/swift-ui';
import {
  accessibilityHidden,
  accessibilityHint,
  accessibilityLabel,
  buttonStyle,
  controlSize,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  multilineTextAlignment,
  opacity,
  padding,
  truncationMode,
} from '@expo/ui/swift-ui/modifiers';

import { QUESTION_BANK_CONTROL_HEIGHT } from '@/question-bank/question-bank-control-geometry';
import {
  QUESTION_BANK_COUNT_COLUMN_WIDTH,
  QUESTION_BANK_TOPIC_LABEL_COLUMN_WIDTH,
  formatQuestionCountForDisplay,
  getTopicQuestionCount,
} from '@/question-bank/question-bank-counts';
import type { QuestionTopicSelectorProps } from '@/question-bank/question-topic-selector.types';

function getGlassAvailability() {
  try {
    return isGlassEffectAPIAvailable() && isLiquidGlassAvailable();
  } catch {
    return false;
  }
}

export function QuestionTopicSelector({
  colorScheme,
  maxWidth,
  onSelect,
  questionCounts,
  selectedTopic,
  secondaryTextColor,
  textColor,
  tintColor,
  topics,
}: QuestionTopicSelectorProps) {
  const [isPresented, setIsPresented] = useState(false);
  const [glassAvailable] = useState(getGlassAvailability);
  const selectedLabel = selectedTopic?.label ?? 'الموضوع';
  const accessibilityText = `موضوع القواعد: ${selectedLabel}`;

  return (
    <View style={[styles.shell, { maxWidth }]}>
      {glassAvailable ? (
        <GlassView
          colorScheme={colorScheme}
          glassEffectStyle="clear"
          isInteractive={false}
          pointerEvents="none"
          style={styles.glassBackdrop}
          tintColor={tintColor}
        />
      ) : (
        <View
          pointerEvents="none"
          style={[styles.glassBackdrop, styles.fallbackBackdrop, { backgroundColor: tintColor }]}
        />
      )}
      <Host
        colorScheme={colorScheme}
        layoutDirection="rightToLeft"
        matchContents={{ horizontal: true, vertical: false }}
        style={{ height: QUESTION_BANK_CONTROL_HEIGHT, maxWidth }}
      >
        <Popover
          arrowEdge="top"
          attachmentAnchor="bottom"
          isPresented={isPresented}
          onIsPresentedChange={setIsPresented}
        >
          <Popover.Trigger>
            <Button
              modifiers={[
                buttonStyle('plain'),
                controlSize('regular'),
                frame({ height: QUESTION_BANK_CONTROL_HEIGHT, maxWidth }),
                accessibilityLabel(accessibilityText),
                accessibilityHint('يفتح قائمة موضوعات القواعد'),
              ]}
              onPress={() => setIsPresented(true)}
            >
              <HStack
                alignment="center"
                spacing={6}
                modifiers={[
                  frame({ height: QUESTION_BANK_CONTROL_HEIGHT, maxWidth }),
                  padding({ horizontal: 12 }),
                  foregroundStyle(textColor),
                ]}
              >
                <Text modifiers={[lineLimit(1), truncationMode('tail')]}>{selectedLabel}</Text>
                <Image systemName="chevron.down" size={13} color={secondaryTextColor} />
              </HStack>
            </Button>
          </Popover.Trigger>
          <Popover.Content>
            <VStack
              alignment="trailing"
              spacing={4}
              modifiers={[padding({ horizontal: 8, vertical: 8 })]}
            >
              {topics.map((topic) => {
                const isSelected = topic.nodeKey === selectedTopic?.nodeKey;
                const questionCount = getTopicQuestionCount(questionCounts, topic.nodeKey);
                const topicAccessibilityLabel = questionCount === undefined
                  ? `${topic.label}${isSelected ? '، محدد' : ''}`
                  : `${topic.label}، ${questionCount} سؤال${isSelected ? '، محدد' : ''}`;
                return (
                  <Button
                    key={topic.nodeKey}
                    modifiers={[
                      buttonStyle('plain'),
                      controlSize('regular'),
                      accessibilityLabel(topicAccessibilityLabel),
                    ]}
                    onPress={() => {
                      onSelect(topic.nodeKey);
                      setIsPresented(false);
                    }}
                  >
                    <HStack
                      alignment="center"
                      spacing={10}
                      modifiers={[
                        frame({
                          height: QUESTION_BANK_CONTROL_HEIGHT,
                        }),
                        padding({ horizontal: 12 }),
                        foregroundStyle(textColor),
                      ]}
                    >
                      <Text
                        modifiers={[
                          frame({ width: QUESTION_BANK_COUNT_COLUMN_WIDTH }),
                          font({ textStyle: 'subheadline' }),
                          foregroundStyle(secondaryTextColor),
                          lineLimit(1),
                          multilineTextAlignment('center'),
                        ]}
                      >
                        {questionCount === undefined
                          ? ''
                          : formatQuestionCountForDisplay(questionCount)}
                      </Text>
                      <HStack
                        alignment="center"
                        spacing={6}
                        modifiers={[
                          frame({ minWidth: QUESTION_BANK_TOPIC_LABEL_COLUMN_WIDTH }),
                        ]}
                      >
                        <Text
                          modifiers={[
                            frame({
                              minWidth: QUESTION_BANK_TOPIC_LABEL_COLUMN_WIDTH,
                              alignment: 'leading',
                            }),
                            lineLimit(1),
                            multilineTextAlignment('leading'),
                            truncationMode('tail'),
                          ]}
                        >
                          {topic.label}
                        </Text>
                        <Image
                          systemName="checkmark"
                          size={16}
                          color={secondaryTextColor}
                          modifiers={[
                            accessibilityHidden(),
                            opacity(isSelected ? 1 : 0),
                          ]}
                        />
                      </HStack>
                    </HStack>
                  </Button>
                );
              })}
            </VStack>
          </Popover.Content>
        </Popover>
      </Host>
    </View>
  );
}

const styles = StyleSheet.create({
  fallbackBackdrop: {
    borderColor: 'rgba(128,128,128,0.25)',
    borderWidth: StyleSheet.hairlineWidth,
  },
  glassBackdrop: {
    borderRadius: QUESTION_BANK_CONTROL_HEIGHT / 2,
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  shell: {
    alignSelf: 'flex-start',
    height: QUESTION_BANK_CONTROL_HEIGHT,
    position: 'relative',
  },
});

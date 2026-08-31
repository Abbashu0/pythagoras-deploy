import { useEffect, useRef, useState } from 'react';
import {
  DropdownMenuItem,
  ExposedDropdownMenu,
  ExposedDropdownMenuBox,
  Host,
  Icon,
  Row,
  Text,
  TextField,
  type TextFieldRef,
  useNativeState,
} from '@expo/ui/jetpack-compose';
import { alpha, menuAnchor, width } from '@expo/ui/jetpack-compose/modifiers';
import checkIcon from '@expo/material-symbols/check.xml';

import {
  QUESTION_BANK_COUNT_COLUMN_WIDTH,
  QUESTION_BANK_TOPIC_LABEL_COLUMN_WIDTH,
  formatQuestionCountForDisplay,
  getTopicQuestionCount,
} from '@/question-bank/question-bank-counts';
import { QUESTION_BANK_CONTROL_HEIGHT } from '@/question-bank/question-bank-control-geometry';
import type { QuestionTopicSelectorProps } from '@/question-bank/question-topic-selector.types';

export function QuestionTopicSelector({
  colorScheme,
  maxWidth,
  onSelect,
  questionCounts,
  selectedTopic,
  secondaryTextColor,
  textColor,
  topics,
}: QuestionTopicSelectorProps) {
  const [expanded, setExpanded] = useState(false);
  const fieldRef = useRef<TextFieldRef>(null);
  const selectedLabel = selectedTopic?.label ?? 'الموضوع';
  const labelState = useNativeState(selectedLabel);

  useEffect(() => {
    labelState.set(selectedLabel);
  }, [labelState, selectedLabel]);

  return (
    <Host
      colorScheme={colorScheme}
      layoutDirection="rightToLeft"
      matchContents={{ horizontal: true, vertical: false }}
      style={{ height: QUESTION_BANK_CONTROL_HEIGHT, maxWidth }}
    >
      <ExposedDropdownMenuBox expanded={expanded} onExpandedChange={setExpanded}>
        <TextField
          ref={fieldRef}
          enabled={topics.length > 0}
          readOnly
          singleLine
          colors={{
            disabledContainerColor: 'transparent',
            disabledTextColor: textColor,
            focusedContainerColor: 'transparent',
            focusedIndicatorColor: 'transparent',
            focusedTextColor: textColor,
            unfocusedContainerColor: 'transparent',
            unfocusedIndicatorColor: 'transparent',
            unfocusedTextColor: textColor,
          }}
          textStyle={{ color: textColor, textAlign: 'right' }}
          value={labelState}
          modifiers={[menuAnchor()]}
        />
        <ExposedDropdownMenu expanded={expanded} onDismissRequest={() => setExpanded(false)}>
          {topics.map((topic) => (
            (() => {
              const isSelected = topic.nodeKey === selectedTopic?.nodeKey;
              const questionCount = getTopicQuestionCount(questionCounts, topic.nodeKey);
              return (
                <DropdownMenuItem
                  key={topic.nodeKey}
                  onClick={() => {
                    onSelect(topic.nodeKey);
                    setExpanded(false);
                  }}
                >
                  <DropdownMenuItem.Text>
                    <Row horizontalArrangement="start" verticalAlignment="center">
                      <Text
                        color={secondaryTextColor}
                        maxLines={1}
                        softWrap={false}
                        style={{ textAlign: 'center', fontSize: 14 }}
                        modifiers={[width(QUESTION_BANK_COUNT_COLUMN_WIDTH)]}
                      >
                        {questionCount === undefined
                          ? ''
                          : formatQuestionCountForDisplay(questionCount)}
                      </Text>
                      <Row horizontalArrangement="start" verticalAlignment="center">
                        <Text
                          color={textColor}
                          maxLines={1}
                          softWrap={false}
                          style={{ textAlign: 'right' }}
                          modifiers={[width(QUESTION_BANK_TOPIC_LABEL_COLUMN_WIDTH)]}
                        >
                          {topic.label}
                        </Text>
                        <Icon
                          contentDescription={isSelected ? 'محدد' : undefined}
                          size={20}
                          source={checkIcon}
                          tint={secondaryTextColor}
                          modifiers={[alpha(isSelected ? 1 : 0)]}
                        />
                      </Row>
                    </Row>
                  </DropdownMenuItem.Text>
                </DropdownMenuItem>
              );
            })()
          ))}
        </ExposedDropdownMenu>
      </ExposedDropdownMenuBox>
    </Host>
  );
}

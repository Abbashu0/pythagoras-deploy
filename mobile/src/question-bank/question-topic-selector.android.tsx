import { useEffect, useRef, useState } from 'react';
import {
  DropdownMenuItem,
  ExposedDropdownMenu,
  ExposedDropdownMenuBox,
  Host,
  Icon,
  Text,
  TextField,
  type TextFieldRef,
  useNativeState,
} from '@expo/ui/jetpack-compose';
import { menuAnchor } from '@expo/ui/jetpack-compose/modifiers';
import checkIcon from '@expo/material-symbols/check.xml';

import { QUESTION_BANK_CONTROL_HEIGHT } from '@/question-bank/question-bank-control-geometry';
import type { QuestionTopicSelectorProps } from '@/question-bank/question-topic-selector.types';

export function QuestionTopicSelector({
  colorScheme,
  maxWidth,
  onSelect,
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
            <DropdownMenuItem
              key={topic.nodeKey}
              onClick={() => {
                onSelect(topic.nodeKey);
                setExpanded(false);
              }}
            >
              <DropdownMenuItem.Text>
                <Text color={textColor}>{topic.label}</Text>
              </DropdownMenuItem.Text>
              {topic.nodeKey === selectedTopic?.nodeKey ? (
                <DropdownMenuItem.TrailingIcon>
                  <Icon
                    contentDescription="محدد"
                    size={20}
                    source={checkIcon}
                    tint={secondaryTextColor}
                  />
                </DropdownMenuItem.TrailingIcon>
              ) : null}
            </DropdownMenuItem>
          ))}
        </ExposedDropdownMenu>
      </ExposedDropdownMenuBox>
    </Host>
  );
}

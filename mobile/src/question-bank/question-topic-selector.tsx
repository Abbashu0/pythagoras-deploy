import { Picker } from '@expo/ui';
import { View } from 'react-native';

import type { QuestionTopicSelectorProps } from '@/question-bank/question-topic-selector.types';

export function QuestionTopicSelector({
  maxWidth,
  onSelect,
  selectedTopic,
  topics,
}: QuestionTopicSelectorProps) {
  return (
    <View style={{ maxWidth }}>
      <Picker
        appearance="menu"
        enabled={topics.length > 0}
        onValueChange={(nodeKey) => onSelect(String(nodeKey))}
        selectedValue={selectedTopic?.nodeKey ?? ''}
      >
        {topics.map((topic) => (
          <Picker.Item key={topic.nodeKey} label={topic.label} value={topic.nodeKey} />
        ))}
      </Picker>
    </View>
  );
}

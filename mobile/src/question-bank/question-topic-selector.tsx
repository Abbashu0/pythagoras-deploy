import { Picker } from '@expo/ui';
import { View } from 'react-native';

import type { QuestionTopicSelectorProps } from '@/question-bank/question-topic-selector.types';

export function QuestionTopicSelector({
  activeSection,
  grammarGroup,
  literatureBank,
  maxWidth,
  onSelect,
  onSectionSelect,
  selectedTopic,
  topics,
}: QuestionTopicSelectorProps) {
  return (
    <View style={{ maxWidth }}>
      <Picker
        appearance="menu"
        enabled={topics.length > 0}
        onValueChange={(value) => {
          const nodeKey = String(value);
          if (nodeKey === grammarGroup.nodeKey) {
            onSectionSelect('grammar');
          } else if (nodeKey === literatureBank.nodeKey) {
            onSectionSelect('literature');
          } else {
            onSelect(nodeKey);
          }
        }}
        selectedValue={
          activeSection === 'literature'
            ? literatureBank.nodeKey
            : selectedTopic?.nodeKey ?? ''
        }
      >
        <Picker.Item label={grammarGroup.label} value={grammarGroup.nodeKey} />
        <Picker.Item label={literatureBank.label} value={literatureBank.nodeKey} />
        {activeSection === 'grammar'
          ? topics.map((topic) => (
              <Picker.Item key={topic.nodeKey} label={topic.label} value={topic.nodeKey} />
            ))
          : null}
      </Picker>
    </View>
  );
}

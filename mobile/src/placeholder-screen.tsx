import { ScrollView, StyleSheet, Text, useColorScheme } from 'react-native';

export function PlaceholderScreen({ title }: { title: string }) {
  const isDark = useColorScheme() === 'dark';

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[
        styles.content,
        { backgroundColor: isDark ? '#000000' : '#ffffff' },
      ]}
    >
      <Text selectable style={[styles.title, { color: isDark ? '#ffffff' : '#000000' }]}>
        {title}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 24,
  },
});

import { View, StyleSheet } from 'react-native';
import { Text, Card } from 'react-native-paper';
import { useRouter } from 'expo-router';

import { getMobileLabels } from '../lib/i18n';

export default function HomeScreen() {
  const router = useRouter();
  const labels = getMobileLabels();

  return (
    <View style={styles.container}>
      <Text variant="headlineMedium" style={styles.title}>
        {labels.home.title}
      </Text>
      <Text variant="bodyMedium" style={styles.subtitle}>
        {labels.home.subtitle}
      </Text>

      <Card style={styles.card} onPress={() => router.push('/chat')}>
        <Card.Title title={labels.home.chatTitle} subtitle={labels.home.chatSubtitle} titleNumberOfLines={2} subtitleNumberOfLines={2} />
        <Card.Content>
          <Text style={styles.body}>{labels.home.chatDescription}</Text>
        </Card.Content>
      </Card>

      <Card style={styles.card} onPress={() => router.push('/nodes')}>
        <Card.Title title={labels.home.nodesTitle} subtitle={labels.home.nodesSubtitle} titleNumberOfLines={2} subtitleNumberOfLines={2} />
        <Card.Content>
          <Text style={styles.body}>{labels.home.nodesDescription}</Text>
        </Card.Content>
      </Card>

      <Card style={styles.card} onPress={() => router.push('/settings')}>
        <Card.Title title={labels.home.settingsTitle} subtitle={labels.home.settingsSubtitle} titleNumberOfLines={2} subtitleNumberOfLines={2} />
        <Card.Content>
          <Text style={styles.body}>{labels.home.settingsDescription}</Text>
        </Card.Content>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#f5f5f5',
  },
  title: {
    marginTop: 32,
    marginBottom: 8,
    fontWeight: 'bold',
  },
  subtitle: {
    marginBottom: 24,
    opacity: 0.7,
  },
  body: {
    flexShrink: 1,
  },
  card: {
    marginBottom: 12,
  },
});

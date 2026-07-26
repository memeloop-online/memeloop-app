import { View, StyleSheet } from 'react-native';
import { Text, Card } from 'react-native-paper';
import { useRouter } from 'expo-router';

export default function HomeScreen() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <Text variant="headlineMedium" style={styles.title}>
        MemeLoop Mobile
      </Text>
      <Text variant="bodyMedium" style={styles.subtitle}>
        Distributed AI Agent Companion
      </Text>

      <Card style={styles.card} onPress={() => router.push('/chat')}>
        <Card.Title title="Agent Chat" subtitle="Start a conversation" />
        <Card.Content>
          <Text>Chat with AI agents running on your local network</Text>
        </Card.Content>
      </Card>

      <Card style={styles.card} onPress={() => router.push('/nodes')}>
        <Card.Title title="Connected Nodes" subtitle="Manage memeloop nodes" />
        <Card.Content>
          <Text>View and connect to memeloop nodes on your network</Text>
        </Card.Content>
      </Card>

      <Card style={styles.card} onPress={() => router.push('/settings')}>
        <Card.Title title="Settings" subtitle="Configure your agent" />
        <Card.Content>
          <Text>Provider settings, cloud auth, and node management</Text>
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
  card: {
    marginBottom: 12,
  },
});

import { View, FlatList, StyleSheet } from 'react-native';
import { Text, Card, Chip, Button } from 'react-native-paper';

type Node = { id: string; name: string; status: 'online' | 'offline'; type: string };

const DEMO_NODES: Node[] = [
  { id: 'local', name: 'Local Desktop', status: 'online', type: 'desktop' },
];

export default function NodesScreen() {
  return (
    <View style={styles.container}>
      <Text variant="titleLarge" style={styles.title}>Connected Nodes</Text>
      <FlatList
        data={DEMO_NODES}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Card style={styles.card}>
            <Card.Title title={item.name} subtitle={item.type} />
            <Card.Content style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Chip icon={item.status === 'online' ? 'check-circle' : 'alert-circle'}>
                {item.status}
              </Chip>
            </Card.Content>
            <Card.Actions>
              <Button>Connect</Button>
            </Card.Actions>
          </Card>
        )}
      />
      <Button mode="contained" style={{ marginTop: 16 }} icon="plus">
        Add Node
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#f5f5f5' },
  title: { marginBottom: 16 },
  card: { marginBottom: 12 },
});

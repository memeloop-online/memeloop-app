import { StyleSheet, View } from 'react-native';
import { Card, Text } from 'react-native-paper';

export default function ChatScreen() {
  return (
    <View style={styles.container}>
      <Card>
      <Card.Content>
          <Text variant="titleMedium">Agent chat is not enabled in this build</Text>
          <Text variant="bodyMedium" style={styles.description}>
            This entry will be enabled only after it is backed by the authenticated DeviceNetwork RPC and synchronized storage boundary.
          </Text>
      </Card.Content>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    backgroundColor: '#f5f5f5',
  },
  description: { marginTop: 8 },
});

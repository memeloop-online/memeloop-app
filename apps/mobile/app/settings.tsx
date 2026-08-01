import { View, StyleSheet } from 'react-native';
import { Text, Card, List, Divider } from 'react-native-paper';

export default function SettingsScreen() {
  return (
    <View style={styles.container}>
      <Text variant="titleLarge" style={styles.title}>Settings</Text>

      <Card style={styles.card}>
        <List.Section>
          <List.Subheader>Device Network</List.Subheader>
          <List.Item title="Device identity" description="Managed in encrypted device storage" left={(props) => <List.Icon {...props} icon="identifier" />} />
          <List.Item title="Nearby discovery" description="Uses authenticated PeerId connections" left={(props) => <List.Icon {...props} icon="radar" />} />
          <Divider />
          <List.Subheader>Cloud</List.Subheader>
          <List.Item title="Cloud URL" description="Not configured" left={(props) => <List.Icon {...props} icon="cloud" />} />
          <List.Item title="Login" description="Sign in to memeloop cloud" left={(props) => <List.Icon {...props} icon="login" />} />
          <Divider />
          <List.Subheader>About</List.Subheader>
          <List.Item title="Version" description="0.1.0" left={(props) => <List.Icon {...props} icon="information" />} />
          <List.Item title="Network address" description="PeerId only" left={(props) => <List.Icon {...props} icon="shield-key" />} />
        </List.Section>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#f5f5f5' },
  title: { marginBottom: 16 },
  card: { marginBottom: 12 },
});

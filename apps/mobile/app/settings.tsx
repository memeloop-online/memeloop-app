import { View, StyleSheet } from 'react-native';
import { Text, Card, List, Divider } from 'react-native-paper';

export default function SettingsScreen() {
  return (
    <View style={styles.container}>
      <Text variant="titleLarge" style={styles.title}>Settings</Text>

      <Card style={styles.card}>
        <List.Section>
          <List.Subheader>Node Connection</List.Subheader>
          <List.Item title="Server URL" description="ws://192.168.1.100:5200" left={(props) => <List.Icon {...props} icon="server" />} />
          <List.Item title="Auto-discover LAN nodes" description="mDNS discovery enabled" left={(props) => <List.Icon {...props} icon="radar" />} />
          <Divider />
          <List.Subheader>Cloud</List.Subheader>
          <List.Item title="Cloud URL" description="Not configured" left={(props) => <List.Icon {...props} icon="cloud" />} />
          <List.Item title="Login" description="Sign in to memeloop cloud" left={(props) => <List.Icon {...props} icon="login" />} />
          <Divider />
          <List.Subheader>About</List.Subheader>
          <List.Item title="Version" description="0.1.0" left={(props) => <List.Icon {...props} icon="information" />} />
          <List.Item title="Node ID" description="Not connected" left={(props) => <List.Icon {...props} icon="identifier" />} />
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

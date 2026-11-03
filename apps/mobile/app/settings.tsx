import { ScrollView, StyleSheet } from 'react-native';
import { Text, Card, List, Divider, useTheme } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getMobileLabels } from '../lib/i18n';

export default function SettingsScreen() {
  const labels = getMobileLabels();
  const theme = useTheme();
  return (
    <SafeAreaView
      edges={['left', 'right', 'bottom']}
      style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      <ScrollView contentContainerStyle={styles.content}>
        <Text variant="titleLarge" style={styles.title}>
          {labels.settings.title}
        </Text>

        <Card style={styles.card}>
          <List.Section>
            <List.Subheader>{labels.settings.deviceNetwork}</List.Subheader>
            <List.Item
              title={labels.settings.deviceIdentity}
              description={labels.settings.deviceIdentityDescription}
              left={(props) => <List.Icon {...props} icon="identifier" />}
            />
            <List.Item
              title={labels.settings.nearbyDiscovery}
              description={labels.settings.nearbyDiscoveryDescription}
              left={(props) => <List.Icon {...props} icon="radar" />}
            />
            <Divider />
            <List.Subheader>{labels.settings.cloud}</List.Subheader>
            <List.Item
              title={labels.settings.cloudUrl}
              description={labels.settings.notConfigured}
              left={(props) => <List.Icon {...props} icon="cloud" />}
            />
            <List.Item
              title={labels.settings.login}
              description={labels.settings.loginDescription}
              left={(props) => <List.Icon {...props} icon="login" />}
            />
            <Divider />
            <List.Subheader>{labels.settings.about}</List.Subheader>
            <List.Item
              title={labels.settings.version}
              description="0.1.0"
              left={(props) => <List.Icon {...props} icon="information" />}
            />
            <List.Item
              title={labels.settings.networkAddress}
              description={labels.settings.peerIdOnly}
              left={(props) => <List.Icon {...props} icon="shield-key" />}
            />
          </List.Section>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16 },
  title: { marginBottom: 16 },
  card: { marginBottom: 12 },
});

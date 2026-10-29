import { Stack } from 'expo-router';
import { PaperProvider } from 'react-native-paper';
import { StatusBar } from 'expo-status-bar';
import { getMobileLabels } from '../lib/i18n';

export default function RootLayout() {
  const labels = getMobileLabels();
  return (
    <PaperProvider>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#1a1a2e' },
          headerTintColor: '#fff',
        }}
      >
        <Stack.Screen name="index" options={{ title: labels.home.title }} />
        <Stack.Screen name="nodes" options={{ title: labels.nodes.title }} />
        <Stack.Screen name="settings" options={{ title: labels.settings.title }} />
        <Stack.Screen name="chat" options={{ title: labels.home.chatTitle }} />
      </Stack>
      <StatusBar style="light" />
    </PaperProvider>
  );
}
import 'react-native-get-random-values';

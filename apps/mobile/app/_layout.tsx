import {
  Stack,
  DarkTheme as NavigationDarkTheme,
  DefaultTheme as NavigationLightTheme,
  ThemeProvider,
} from 'expo-router';
import { useColorScheme } from 'react-native';
import { MD3DarkTheme, MD3LightTheme, PaperProvider } from 'react-native-paper';
import { StatusBar } from 'expo-status-bar';
import { getMobileLabels } from '../lib/i18n';

export default function RootLayout() {
  const labels = getMobileLabels();
  const dark = useColorScheme() === 'dark';
  const theme = dark ? MD3DarkTheme : MD3LightTheme;
  const navigationTheme = {
    ...(dark ? NavigationDarkTheme : NavigationLightTheme),
    colors: {
      primary: theme.colors.primary,
      background: theme.colors.background,
      card: theme.colors.surface,
      text: theme.colors.onSurface,
      border: theme.colors.outline,
      notification: theme.colors.error,
    },
  };
  return (
    <PaperProvider theme={theme}>
      <ThemeProvider value={navigationTheme}>
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: theme.colors.surface },
            headerTintColor: theme.colors.onSurface,
            contentStyle: { backgroundColor: theme.colors.background },
          }}
        >
          <Stack.Screen name="index" options={{ title: labels.home.title }} />
          <Stack.Screen name="nodes" options={{ title: labels.nodes.title }} />
          <Stack.Screen name="settings" options={{ title: labels.settings.title }} />
          <Stack.Screen name="chat" options={{ title: labels.home.chatTitle }} />
        </Stack>
        <StatusBar style={dark ? 'light' : 'dark'} />
      </ThemeProvider>
    </PaperProvider>
  );
}

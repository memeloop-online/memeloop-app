/**
 * Page-level rendering tests for Preferences sections.
 * These tests verify that each section renders its key UI elements,
 * regardless of whether the section is schema-driven or uses a custom component.
 * This acts as a safety net during schema-ification of complex sections.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { ThemeProvider } from '@mui/material/styles';
import { LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { lightTheme } from '@services/theme/defaultTheme';
import { BehaviorSubject } from 'rxjs';

import { defaultPreferences } from '@services/preferences/defaultPreferences';
import type { IPreferences } from '@services/preferences/interface';
import { registerCustomSections } from '../registerCustomSections';
import { AllSectionsRenderer } from '../SchemaRenderer';

// Register custom section components
registerCustomSections();

const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <LocalizationProvider dateAdapter={AdapterDateFns}>
    <ThemeProvider theme={lightTheme}>
      {children}
    </ThemeProvider>
  </LocalizationProvider>
);

const createMockPreference = (overrides: Partial<IPreferences> = {}): IPreferences => ({
  ...defaultPreferences,
  ...overrides,
});

describe('Preferences - All Sections Rendering', () => {
  let preferenceSubject: BehaviorSubject<IPreferences | undefined>;

  beforeEach(() => {
    vi.clearAllMocks();

    preferenceSubject = new BehaviorSubject<IPreferences | undefined>(
      createMockPreference(),
    );

    Object.defineProperty(window.observables.preference, 'preference$', {
      value: preferenceSubject.asObservable(),
      writable: true,
    });

    Object.defineProperty(window.observables, 'systemPreference', {
      value: {
        systemPreference$: new BehaviorSubject({}).asObservable(),
      },
      writable: true,
      configurable: true,
    });

    Object.defineProperty(window.service.context, 'get', {
      value: vi.fn().mockImplementation(async (key: string) => {
        const contextValues: Record<string, unknown> = {
          platform: 'win32',
          isTest: 'true',
          LOG_FOLDER: 'C:\\logs',
          SETTINGS_FOLDER: 'C:\\settings',
          V8_CACHE_FOLDER: 'C:\\v8cache',
          INSTALLER_LOG_FOLDER: 'C:\\installerlogs',
          supportedLanguagesMap: { 'zh-Hans': '简体中文' },
        };
        return contextValues[key] ?? '';
      }),
      writable: true,
    });

    Object.defineProperty(window.service.preference, 'set', {
      value: vi.fn(async (key: string, value: unknown) => {
        const current = preferenceSubject.value;
        if (current) {
          preferenceSubject.next({ ...current, [key]: value });
        }
      }),
      writable: true,
    });

    Object.defineProperty(window.service.native, 'openPath', {
      value: vi.fn().mockResolvedValue(undefined),
      writable: true,
    });

    Object.defineProperty(window.service.native, 'openURI', {
      value: vi.fn().mockResolvedValue(undefined),
      writable: true,
    });

    // database may not exist in the mock; ensure it's an object first
    if (!('database' in window.service)) {
      (window.service as Record<string, unknown>).database = {};
    }
    Object.defineProperty(window.service.database, 'getDatabaseInfo', {
      value: vi.fn().mockResolvedValue({ exists: false }),
      writable: true,
      configurable: true,
    });

    Object.defineProperty(window.service.database, 'getDatabasePath', {
      value: vi.fn().mockResolvedValue(''),
      writable: true,
      configurable: true,
    });

    Object.defineProperty(window.service.window, 'updateWindowMeta', {
      value: vi.fn().mockResolvedValue(undefined),
      writable: true,
      configurable: true,
    });

    Object.defineProperty(window.service.window, 'open', {
      value: vi.fn().mockResolvedValue(undefined),
      writable: true,
      configurable: true,
    });

    if (!('notification' in window.service)) {
      (window.service as Record<string, unknown>).notification = {};
    }
    Object.defineProperty(window.service.notification, 'show', {
      value: vi.fn().mockResolvedValue(undefined),
      writable: true,
      configurable: true,
    });

    if (!('systemPreference' in window.service)) {
      (window.service as Record<string, unknown>).systemPreference = {};
    }
    Object.defineProperty(window.service.systemPreference, 'setSystemPreference', {
      value: vi.fn().mockResolvedValue(undefined),
      writable: true,
      configurable: true,
    });
  });

  const renderAllSections = async () => {
    const sectionRefs = new Map<string, React.RefObject<HTMLSpanElement | null>>();
    const result = render(
      <TestWrapper>
        <AllSectionsRenderer
          onNeedsRestart={() => {}}
          sectionRefs={sectionRefs}
        />
      </TestWrapper>,
    );

    // Tests render every active App section synchronously. Wait for the last one.
    await waitFor(() => {
      expect(screen.queryByText('Preference.Updates')).toBeInTheDocument();
    }, { timeout: 5000 });

    return result;
  };

  // ─── General section ─────────────────────────────────────────────

  it('should render General section with key settings', async () => {
    await renderAllSections();
    expect(screen.getByText('Preference.General')).toBeInTheDocument();
    expect(screen.getByText('Preference.Theme')).toBeInTheDocument();
    expect(screen.getByText('Preference.ShowTitleBar')).toBeInTheDocument();
    expect(screen.getByText('Preference.AlwaysOnTop')).toBeInTheDocument();
  });

  // ─── Performance section ─────────────────────────────────────────

  it('should render Performance section', async () => {
    await renderAllSections();
    expect(screen.getByText('Preference.Performance')).toBeInTheDocument();
    expect(screen.getByText('Preference.hardwareAcceleration')).toBeInTheDocument();
  });

  // ─── Downloads section ───────────────────────────────────────────

  it('should render Downloads section', async () => {
    await renderAllSections();
    expect(screen.getByText('Preference.Downloads')).toBeInTheDocument();
    expect(screen.getByText('Preference.AskDownloadLocation')).toBeInTheDocument();
  });

  // ─── Network section ────────────────────────────────────────────

  // ─── Privacy section ────────────────────────────────────────────

  // ─── Updates section ────────────────────────────────────────────

  it('should render Updates section', async () => {
    await renderAllSections();
    expect(screen.getByText('Preference.Updates')).toBeInTheDocument();
    expect(screen.getByText('Preference.ReceivePreReleaseUpdates')).toBeInTheDocument();
  });

  // ─── Miscellaneous section ──────────────────────────────────────

  // ─── Notifications section ──────────────────────────────────────

  it('should render Notifications section', async () => {
    await renderAllSections();
    await waitFor(() => {
      expect(screen.getByText('Preference.Notifications')).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  // ─── TidGiMiniWindow section ────────────────────────────────────
  // ─── Developers section ─────────────────────────────────────────

  // ─── Boolean toggle interaction ─────────────────────────────────
  it('should toggle a boolean preference (alwaysOnTop)', async () => {
    await renderAllSections();
    // Find the switch for alwaysOnTop
    const label = screen.getByText('Preference.AlwaysOnTop');
    const listItem = label.closest('li')!;
    const switchElement = within(listItem).getByRole('switch');

    expect(switchElement).not.toBeChecked();

    await userEvent.click(switchElement);

    await waitFor(() => {
      expect(window.service.preference.set).toHaveBeenCalledWith('alwaysOnTop', true);
    });
  });
});

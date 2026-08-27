import { BehaviorSubject } from 'rxjs';
import { vi } from 'vitest';
import { serviceInstances } from './services-container';

// Mock window.meta
globalThis.window = globalThis.window || {};
Object.defineProperty(window, 'meta', {
  writable: true,
  value: vi.fn(() => ({
    windowName: 'main',
  })),
});

// Mock window.remote
Object.defineProperty(window, 'remote', {
  writable: true,
  value: {
    registerOpenFindInPage: vi.fn(),
    registerCloseFindInPage: vi.fn(),
    registerUpdateFindInPageMatches: vi.fn(),
    unregisterOpenFindInPage: vi.fn(),
    unregisterCloseFindInPage: vi.fn(),
    unregisterUpdateFindInPageMatches: vi.fn(),
    registerAskAIWithSelection: vi.fn(),
    unregisterAskAIWithSelection: vi.fn(),
  },
});

// Mock window.observables
Object.defineProperty(window, 'observables', {
  writable: true,
  value: {
    preference: {
      preference$: new BehaviorSubject({}).asObservable(),
    },
    updater: {
      updaterMetaData$: new BehaviorSubject(undefined).asObservable(),
    },
    externalAPI: {
      defaultConfig$: new BehaviorSubject({
        default: { provider: 'openai', model: 'gpt-4' },
        modelParameters: { temperature: 0.7, topP: 0.95 },
      }).asObservable(),
      providers$: new BehaviorSubject([]).asObservable(),
    },
    agentInstance: {},
  },
});

// Mock window.service
Object.defineProperty(window, 'service', {
  writable: true,
  value: serviceInstances,
});

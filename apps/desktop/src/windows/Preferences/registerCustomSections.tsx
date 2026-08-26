/**
 * Wires custom section components and custom item components to their definitions.
 * Call once at app startup (before rendering Preferences).
 */
import { sectionById } from '@services/preferences/definitions/registry';
import type { ICustomSectionProps } from '@services/preferences/definitions/types';
import { type ComponentType, lazy, type LazyExoticComponent, Suspense } from 'react';
import { registerCustomComponent } from './customComponentRegistry';
import { LanguageSelectorItem } from './customItems/LanguageSelectorItem';
import { NotificationHelpTextItem, NotificationTestItem } from './customItems/NotificationItems';
import { NotificationScheduleItem } from './customItems/NotificationScheduleItem';
import { OpenAtLoginItem } from './customItems/OpenAtLoginItem';

// ─── Lazy-loaded section-level custom components (very complex sections) ──
const LazyExternalAPISection = lazy(() => import('./sections/ExternalAPI').then((m) => ({ default: m.ExternalAPI })));
const LazyAIModelsSection = lazy(() => import('./sections/AIModels').then((m) => ({ default: m.AIModels })));
const LazyAIAgentSection = lazy(() => import('./sections/AIAgent').then((m) => ({ default: m.AIAgent })));

function wrapWithSuspense(LazyComponent: LazyExoticComponent<ComponentType<ICustomSectionProps>>): ComponentType<ICustomSectionProps> {
  return function SuspenseWrapper(props: ICustomSectionProps) {
    return (
      <Suspense fallback={<div />}>
        <LazyComponent {...props} />
      </Suspense>
    );
  };
}

let registered = false;

export function registerCustomSections(): void {
  if (registered) return;
  registered = true;

  // Section-level custom components (dialogs, tables, polling, etc.)
  const registerSection = (sectionId: string, component: LazyExoticComponent<ComponentType<ICustomSectionProps>>) => {
    const section = sectionById.get(sectionId);
    if (section) {
      section.CustomSectionComponent = wrapWithSuspense(component);
    }
  };
  registerSection('externalAPI', LazyExternalAPISection);
  registerSection('aiModels', LazyAIModelsSection);
  registerSection('aiAgent', LazyAIAgentSection);

  // Item-level custom components (small self-contained widgets)
  registerCustomComponent('system.openAtLogin', OpenAtLoginItem);
  registerCustomComponent('languages.selector', LanguageSelectorItem);
  registerCustomComponent('notifications.schedule', NotificationScheduleItem);
  registerCustomComponent('notifications.test', NotificationTestItem);
  registerCustomComponent('notifications.helpText', NotificationHelpTextItem);
}

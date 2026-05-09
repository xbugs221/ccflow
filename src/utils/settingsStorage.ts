// PURPOSE: Centralize provider-neutral browser settings persistence.
import type { ProjectSortOrder as SettingsProjectSortOrder } from '../components/settings/types/types';

export const CCFLOW_SETTINGS_KEY = 'ccflow-settings';

const LEGACY_PROVIDER_SETTINGS_KEY = ['claude', 'settings'].join('-');

type StoredSettings = {
  projectSortOrder?: SettingsProjectSortOrder;
  lastUpdated?: string;
  [key: string]: unknown;
};

/**
 * Parse a settings blob from localStorage without letting malformed data escape.
 */
const parseSettings = (raw: string | null): StoredSettings => {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as StoredSettings : {};
  } catch {
    return {};
  }
};

/**
 * Read the active provider-neutral settings, falling back to the legacy key
 * only long enough for the next save to migrate the value.
 */
export const readCcflowSettings = (): StoredSettings => {
  try {
    const currentSettings = parseSettings(localStorage.getItem(CCFLOW_SETTINGS_KEY));
    if (Object.keys(currentSettings).length > 0) {
      return currentSettings;
    }

    return parseSettings(localStorage.getItem(LEGACY_PROVIDER_SETTINGS_KEY));
  } catch {
    return {};
  }
};

/**
 * Read the saved project ordering preference.
 */
export const readProjectSortOrderSetting = (): SettingsProjectSortOrder => {
  const settings = readCcflowSettings();
  return settings.projectSortOrder === 'date' ? 'date' : 'name';
};

/**
 * Persist the project ordering preference under the provider-neutral key.
 */
export const writeProjectSortOrderSetting = (
  projectSortOrder: SettingsProjectSortOrder,
  updatedAt: string = new Date().toISOString(),
) => {
  localStorage.setItem(CCFLOW_SETTINGS_KEY, JSON.stringify({
    projectSortOrder,
    lastUpdated: updatedAt,
  }));
};

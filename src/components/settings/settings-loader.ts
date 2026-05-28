import { query, revalidate } from "@solidjs/router";

import {
  getSettings,
  getTranslationSettings,
} from "~/server/settings/settings";

export const getSettingsState = query(async () => {
  "use server";

  return getSettings();
}, "settings-state");

export const getReaderTranslationSettingsState = query(async () => {
  "use server";

  return getTranslationSettings();
}, "reader-translation-settings-state");

export function revalidateSettingsState() {
  return Promise.all([
    revalidate(getSettingsState.key),
    revalidate(getReaderTranslationSettingsState.key),
  ]).then(() => undefined);
}

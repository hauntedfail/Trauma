import { query, revalidate } from "@solidjs/router";

import { getSettings } from "~/server/settings/settings";

export const getSettingsState = query(async () => {
  "use server";

  return getSettings();
}, "settings-state");

export function revalidateSettingsState() {
  return revalidate(getSettingsState.key);
}

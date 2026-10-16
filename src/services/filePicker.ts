/** Native builds do not offer file import (no document picker is bundled); see filePicker.web.ts. */
export const fileImportSupported = false;

export async function pickTextFile(): Promise<string | null> {
  throw new Error('Importing a file is available on the EcoMove website.');
}

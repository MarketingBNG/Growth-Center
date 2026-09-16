'use client';

/**
 * Reads a submitted form as trimmed strings, with empty meaning absent.
 *
 * The three "New …" dialogs each built this by hand. `undefined` rather than `''` is the
 * load-bearing part: these bodies go to Zod schemas where an optional field may be omitted
 * but not be blank, so a form left empty has to send nothing rather than send emptiness.
 */
export function formValues(form: HTMLFormElement) {
  const data = new FormData(form);
  return (key: string): string | undefined => {
    const v = (data.get(key) as string | null)?.trim();
    return v ? v : undefined;
  };
}

import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * The named steps of the type scale, declared to tailwind-merge.
 *
 * Without this it cannot tell them apart from text colours — `text-meta` and
 * `text-muted-foreground` are the same shape — so it treats them as one group, keeps
 * whichever came last, and silently drops the other. Every badge in the app went out at
 * the browser's default 16px because its variant string reads
 * `text-meta … text-muted-foreground` and the size lost.
 *
 * Nothing errors when this is wrong: the class is simply absent from the element and the
 * text inherits a size. That is also why it cannot be caught by looking for the class —
 * once stripped there is nothing to find. e2e/type-scale.spec.ts checks it the only way
 * that works, by measuring what the page actually renders.
 *
 * Keep in step with the --text-* tokens in app/globals.css.
 */
const TYPE_SCALE = ['micro', 'meta', 'body', 'label', 'lead', 'title', 'figure', 'display'];

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: TYPE_SCALE }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

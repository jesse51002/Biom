// SPDX-License-Identifier: AGPL-3.0-only
// The one runtime primitive that genuinely belongs to everybody. Layer 0.
//
// This is what makes the import graph acyclic in code rather than only on
// paper. Views need to redraw when the store changes, which as an import would
// be store → views and a cycle. Instead a composition root at the top hands the
// store an anonymous function, so the store holds a callback and has no idea a
// view exists. Calls descend through imports; data ascends through
// subscriptions a higher layer registered.

/**
 * @template T
 * @returns {{ on: (fn: (v: T) => void) => () => void, emit: (v: T) => void, size: () => number }}
 */
export function emitter() {
  const listeners = new Set();
  return {
    /** Returns its own unsubscribe, so a caller never has to keep the fn. */
    on(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Iterates a copy: a listener that unsubscribes itself mid-emit is
     *  ordinary, and mutating the set during iteration would skip the next. */
    emit(v) {
      for (const fn of [...listeners]) fn(v);
    },
    size: () => listeners.size,
  };
}

#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
# A WINDOW MANAGER ON THE DISPLAY, because a bare X server has nobody to ask.
#
# `Xvfb` is a screen and nothing else. Maximise and full screen are not things a
# window does to itself — the application sets `_NET_WM_STATE_MAXIMIZED_*` or
# `_NET_WM_STATE_FULLSCREEN` and a WINDOW MANAGER honours it — so on a bare
# virtual display the request is made, nobody answers, and the window's state
# never changes. That is exactly how `make e2e` failed on a runner while passing
# on a desktop, where a compositor was doing the honouring.
#
# So: this script is what `tests/e2e/app.e2e.ts` puts between `xvfb-run` and the
# application. It starts a window manager on whatever `$DISPLAY` it was handed —
# openbox first, then fluxbox, then icewm, all of which honour both hints and
# start in well under a second — waits for the manager to actually own the root
# window, and then EXECS the command it was given, so the process tree and the
# signals are what they were without it.
#
#   screen.sh <command> [args…]   start a manager if there is none, then exec
#   screen.sh --probe             print the manager's name, or nothing at all
#
# `--probe` IS THE SAME CODE PATH, and that is the point of it: the suite asks
# this script, under `xvfb-run` exactly as it will launch, whether a window
# manager can be had — and where the answer is no, the one step that needs one
# is skipped by name rather than failing. "openbox is installed" is a different
# question from "openbox took the display", and only the second one matters.
#
# A MANAGER THAT IS ALREADY THERE IS LEFT ALONE. On somebody's desktop the
# compositor owns the display and starting a second manager would be a fight
# over it; `_NET_SUPPORTING_WM_CHECK` on the root window is how X says whether
# one is running, and `xprop` is how that is read.
set -eu

# In order of how fast they come up. Every one of them is EWMH-aware, which is
# the whole requirement: the two state hints above, honoured.
MANAGERS="openbox fluxbox icewm"

# Is somebody managing $DISPLAY? A missing `xprop` cannot tell us, and "cannot
# tell" is answered as no — the callers below both treat that correctly.
managed() {
  command -v xprop >/dev/null 2>&1 || return 1
  xprop -root -notype _NET_SUPPORTING_WM_CHECK 2>/dev/null | grep -q 'window id # 0x'
}

# Start the first one that is installed and wait for it to own the root window,
# bounded at five seconds. Prints its name on success, nothing on failure.
start() {
  for wm in $MANAGERS; do
    command -v "$wm" >/dev/null 2>&1 || continue
    "$wm" >/dev/null 2>&1 &
    if command -v xprop >/dev/null 2>&1; then
      i=0
      while [ "$i" -lt 100 ]; do
        if managed; then printf '%s' "$wm"; return 0; fi
        i=$((i + 1))
        sleep 0.05
      done
      # It was asked for and never took the display. Saying so on stderr is the
      # difference between a mystery and a sentence; the caller reads the empty
      # answer and skips the step that needed it.
      echo "screen.sh: $wm was started and never took $DISPLAY" >&2
      return 1
    fi
    # No `xprop` to confirm with. Give it a moment and take its word.
    sleep 1
    printf '%s' "$wm"
    return 0
  done
  return 1
}

if [ "${DISPLAY:-}" = "" ]; then
  which=""
elif managed; then
  which="the one already on ${DISPLAY}"
else
  which=$(start || true)
fi

if [ "${1:-}" = "--probe" ]; then
  [ -n "$which" ] && printf '%s\n' "$which"
  exit 0
fi

# EXEC, so the application is the direct child of `xvfb-run` and a kill of the
# one is a kill of the other. The manager stays a background process on the
# display and goes away with it when `xvfb-run` takes the server down.
exec "$@"

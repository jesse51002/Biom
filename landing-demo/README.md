# Landing page demo

The eight-second GIF that sits directly after the hero on biom.dev: a prompt
sent from Biom's chat panel, the agent's research counts, and the finished
**Fintech leads** page appearing under **Leads**, saved as an automation. It
plays and loops on its own and has no controls.

This folder is a production tool. Only the exported files go on the website.
Nothing here is part of the framework: no layer, no import into it, and the
stage reads Biom's own `client/css/tokens.css`, fonts and `app/icon.png` only
so the window wears the product's real type and palette.

| File | What it is |
|---|---|
| `timeline.js` | Every word, the sample data and the clock, in one place |
| `stage.html` | Biom's window, with `renderAt(t)`. A pure function of `t`, with no transitions or timers |
| `render.mjs` | Steps the stage at 15 fps, then writes the GIFs, stills and previews into `out/` |
| `section.html` | The drop-in section for the landing page |
| `out/` | The exported GIFs, still frames and `preview-*.html` |

```
make install                                   # Playwright
node landing-demo/render.mjs                   # everything, ~1 min
node landing-demo/render.mjs desktop accurate  # one GIF
node landing-demo/render.mjs --frame 2.4,6     # stills at those seconds, into out/.frames/
node landing-demo/render.mjs --preview         # only the preview pages
```

It needs ffmpeg on the PATH, and either the Chromium from `make browser` or
`PLAYWRIGHT_CHROMIUM`.

## Two variants

`scheduled` is the brief as written: *"Every Monday, …"*, ending on an
**Every Monday** chip. `accurate` says only what this build does. An
automation is a folder on the page, started from its Automations screen, and
the workspace has **no scheduler**: the seeded root page tells people *"there
is no clock in this workspace"*, and `vault/docs/automations.md` and the
runs guide say the same. A weekly run would come from the agent's own
scheduling, not from Biom. Pick one before publishing. Each variant is one
entry in `VARIANTS`.

## How it is exported

- 1920×1200 for desktop (a 1280×800 stage drawn at 1.5×) and 780×1240 for mobile
  (a 390×620 stage drawn at 2×). Mobile is its own composition, not the desktop
  view scaled down.
- One palette per GIF (`palettegen`), Bayer dither, and rectangle-diff frames
  (`paletteuse diff_mode=rectangle`).
- `mpdecimate` with zero tolerance drops frames identical to the one before.
  The GIF keeps 1/15 s timestamps, so the 2.7 s final hold is a single frame
  with a long delay, and the total length is exactly 8.00 s.
- The loop seam is a 0.2 s cross-fade into a copy of the window drawn at
  `t = 0`.

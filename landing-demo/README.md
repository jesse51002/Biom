# Landing page demo

Short looping GIFs (8–9 s) for the section directly after the hero on biom.dev. Each
one plays a single request in Biom's window: the prompt is sent from the chat
panel, the agent's working steps stay on screen, and the result lands in the
workspace. The GIFs play and loop on their own and have no controls.

This folder is a production tool. Only the exported files go on the website.
Nothing here is part of the framework: no layer, no import into it, and the
stage reads Biom's own `client/css/tokens.css`, fonts and `app/icon.png` only
so the window wears the product's real type and palette.

## Scenarios

| Name | What it shows |
|---|---|
| `roadmap` | **The recommended one, 9 s.** On Fernway's Roadmap board, the founder asks the agent to read this week's customer calls. The call pages light up in the sidebar as they are read, and their names gather under the step in the chat. The agent finds 31 requests in 5 themes and ranks the top three by ARR. It then updates the board in place, one change at a time: *SSO for teams* lands in Next with four customers, $38k ARR, who asked, a quote and the calls linked; then two existing cards gain customers, each marked with a +2 and an amber edge that stays. |
| `leads-scheduled` | The first demo: a Fintech leads page appears under Leads, saved as an automation for "Every Monday". |
| `leads-accurate` | The same demo, but it claims only what the build does. Biom has no scheduler, so this version shows "Run again from Automations". |

Every claim in `roadmap` was checked against the build. The board is the
shipped `biom-kanban` page type over a workspace table. An agent writes its
rows with `row.insert` and `row.update`. Call notes are ordinary pages the
agent reads from the folder. It needs no scheduler and no connector. All
names, quotes and figures are invented, and each GIF says so in its corner.

## Files

| File | What it is |
|---|---|
| `clock.js` | The loop length, the easing, the typing and the working lamp, shared by every scenario |
| `scenarios/*.js` | One scenario per file: its words, data, beats, canvas and the canvas's own motion |
| `stage.html` | What every scenario shares: the title bar, the rail, the chat, the input box, the strip, the narrow composition and the loop seam. `renderAt(t)` is a pure function of `t`, with no transitions or timers |
| `render.mjs` | Steps the stage at 15 fps, then writes the GIFs, stills and previews into `out/` |
| `section.html` | The drop-in section for the landing page |
| `out/` | `demo-<scenario>-<layout>.gif`, `-still.png` and `preview-<scenario>.html` |

```
make install                                        # Playwright
node landing-demo/render.mjs                        # everything, ~1 min
node landing-demo/render.mjs roadmap desktop        # one GIF
node landing-demo/render.mjs --frame 2.4,6 roadmap  # stills at those seconds, into out/.frames/
node landing-demo/render.mjs --preview              # only the preview pages
```

It needs ffmpeg on the PATH, and either the Chromium from `make browser` or
`PLAYWRIGHT_CHROMIUM`.

To add a scenario, write `scenarios/<name>.js` exporting the same shape as
`roadmap.js` and add it to `scenarios/index.js`.

## How it is exported

- 1920×1200 for desktop (a 1280×800 stage drawn at 1.5×) and 780×1240 for mobile
  (a 390×620 stage drawn at 2×). Mobile is its own composition, not the desktop
  view scaled down: it shows the chat first, then trades it for the result.
- One palette per GIF (`palettegen`), Bayer dither, and rectangle-diff frames
  (`paletteuse diff_mode=rectangle`).
- `mpdecimate` with zero tolerance drops frames identical to the one before.
  The GIF keeps 1/15 s timestamps, so the final hold is a single frame with a
  long delay, and the total length is exactly the scenario's (8.00 s by
  default, or its `duration`).
- The loop seam dips what the turn changed (the canvas, the thread, the
  input) out to the bare window over 0.25 s, then fades in a copy of the
  window drawn at `t = 0`. Two states of the page never show at once.

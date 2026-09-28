Third-party code, served as it sits and never patched. What is built or
converted here out of upstream's own files says so where it is described, with
the command that reproduces it.

| | version | which upstream build, and why that one |
|---|---|---|
| `markdown-it.mjs` | 15.0.0 | `dist/browser/markdown-it.esm.min.mjs` — SELF-CONTAINED |
| `markdown-it.min.js` | 15.0.0 | `dist/browser/markdown-it.umd.min.js` — the UMD build, for a frame |
| `markdown-it.d.mts` | — | ours, hand-written, deliberately partial |
| `mermaid.min.js` | 11.16.1 | `dist/mermaid.min.js` — the IIFE build |
| `three.min.js` | 0.180.0 | BUILT here — upstream ships no classic build any more |
| `yaml.mjs` | 2.9.0 | `browser/` — a TREE upstream, bundled here into one file |
| `yaml.d.ts` | — | ours, hand-written, deliberately partial. `.d.ts`, NOT `.d.mts` |
| `xterm.mjs` | 6.0.0 | `@xterm/xterm` `lib/xterm.mjs` — the self-contained ESM build, for the HOST |
| `xterm.css` | 6.0.0 | `@xterm/xterm` `css/xterm.css`, verbatim |
| `xterm.d.ts` | — | ours, hand-written, deliberately partial |
| `addon-fit.mjs` | 0.11.0 | `@xterm/addon-fit` `lib/addon-fit.mjs` — the self-contained ESM build |
| `addon-fit.d.ts` | — | ours, hand-written, deliberately partial |
| `noto/*.webp` | `latest`, fetched 2026-09-26 | Google's animated Noto emoji, `512.gif` — CONVERTED here to 64 px animated WebP, CC BY 4.0 |

**xterm.js is the sign-in pop-up's emulator, and it runs in the HOST, never in a
box.** `client/boot.js` imports it through the import map in `client/index.html`
and hands the constructor to `client/views/terminal.js`, so no other module
names it. It is emulation only — the command, the PTY and every process
decision are the server's (`server/platform/pty.ts`,
`server/workspace/terminals.ts`).
Both builds are upstream's own single-file ESM with one `export` and no
`import`, copied as they sit; the `sourceMappingURL` comment at the foot of each
names a `.map` that is deliberately not vendored, so an open DevTools reports
one missing file and nothing else does. No addon that opens links or reads the
clipboard is vendored, on the emulator's own security guidance.

```
npm pack @xterm/xterm@6.0.0 @xterm/addon-fit@0.11.0
sha256  lib/xterm.mjs          b336ec65a086c056d4804b3d4c2347da5663d3f23c3f25be866467bd8857ad59
sha256  css/xterm.css          854a7c0fb70e8b1a083c16797ab827299fb18744f5ad34f227b48337e33293c6
sha256  lib/addon-fit.mjs      2d87e1bddc73be9111de8beee5370c3bb7aac9c94e18e6f245f02ca741ef1769
```

**Upstream's `typings/*.d.ts` are ambient `declare module` blocks**, which
`tsconfig` `paths` cannot resolve to as a module — so the declarations beside
the bundles are ours and partial, for the same reason `markdown-it.d.ts` is.

**`three` ships no classic build at all, so this one was built rather than copied.**
Upstream dropped its UMD bundle years ago and now publishes ESM and CJS only —
and **a module script does not load at an opaque origin**, which is the one thing
a page box is. So the ES module was wrapped in three lines that put it on the
global and bundled as an IIFE, with nothing patched:

```
npm pack three@0.180.0 && tar xzf three-0.180.0.tgz
printf 'import * as THREE from "./package/build/three.module.js";\nglobalThis.THREE = THREE;\n' > entry.js
bun build entry.js --format=iife --target=browser --minify --outfile=vendor/three.min.js
```

706KB, one file, no dependencies, `window.THREE` when it has run.

**IT WAS VERIFIED IN A BROWSER, INSIDE THE BOX, and the measurement is the whole
reason to trust it.** From a section's own realm on a real page: `location.origin`
is `"null"`, `fetch("/vendor/three.min.js")` is REFUSED, a classic
`<script src="/vendor/three.min.js">` LOADS, `THREE.REVISION` reads `180`, a
`WebGLRenderer` constructs and `render()` puts real pixels on a canvas. That is
the asymmetry the boundary is built on — the box may RUN host-served code and may
not READ anything back — and it is checked rather than assumed, because `tsc` and
`bun` resolve through `paths` and a browser resolves through the import map, and
only one of those is the product.

**It is 706KB, so it is loaded ON DEMAND and never otherwise.** A page with no WebGL on it must not pay for this file, and a page that has one
must still draw its words if the load fails or the machine has no GPU.

**`yaml` ships no single file, so this one was built rather than copied.**
Upstream's package is 74 ES modules under `browser/` and 74 more under `dist/`;
there is no `yaml.min.mjs` to take. The `browser/` half is the one with no node
built-ins in it — checked, not assumed — so it is the half that was bundled,
entry point and all, with nothing patched:

```
npm pack yaml@2.9.0 && tar xzf yaml-2.9.0.tgz
bun build package/browser/index.js --format=esm --target=browser --minify --outfile=vendor/yaml.mjs
```

106KB, one file, no dependencies. **A bundle is not a patch** — every byte in it
is upstream's, and the command above reproduces it — but it is the one file here
that is not a straight copy, so it says so rather than looking like one.

**`yaml` is reached through `tsconfig` `paths` and nothing else.** Only the
SERVER parses: the client is handed `Page` as JSON and never sees YAML. So
unlike `markdown-it` there is no import map entry in `client/index.html` and no
browser to verify it in — bun resolves it at runtime and tsc resolves it to
typecheck, and those are the only two readers there are.

**The declaration is `yaml.d.ts` and the extension is load-bearing.** An
extensionless specifier gives TypeScript five candidates — `.ts`, `.tsx`,
`.d.ts`, `.js`, `.jsx` — and **`.d.mts` is not one of them**, so a `.d.mts`
beside the bundle is never found and the import simply does not resolve. From a
`.js` importer that failure is SILENT; from a `.ts` importer it is `TS2307`.
**`markdown-it.d.mts` has this bug right now** and gets away with it only
because its one importer is `client/platform/markdown.js`, so `markdown-it` is
an implicit `any` rather than the typed surface that file was written against.
The two extensions have to disagree, and they do: bun's own candidate list has
`.mjs` and not `.d.ts`, so bun reaches the bundle by the same bare name that
tsc uses to reach the declaration.

**What it is used for, and what it is not.** `server/platform/yaml.ts` reads and
writes `content.yaml`, which holds a whole page including its prose. Markdown
comes back out as a block scalar rather than a quoted line, because a person
opens that file. The one upstream behaviour worth knowing is that this version
writes U+2028 and U+2029 raw; the codec's header says why that is recorded
rather than worked around, and a test pins it so a version bump is visible.

**Take the browser build, not the Node one.** `dist/markdown-it.mjs` looks right
and is not: its first five lines import `mdurl`, `uc.micro`, `entities`,
`linkify-it` and `punycode.js`, so no browser can load it and vendoring it would
mean vendoring a dependency tree. This mistake was made once here, and it passed
`tsc` and `bun test` while being unloadable in a browser — because those two
resolve through `tsconfig` `paths` and the browser resolves through the import
map. **Different mechanisms. Only one of them is the product.** Check a vendored
file in a browser, not in a test runner.

**markdown-it is vendored TWICE, and the second copy is not a duplicate.**
`markdown-it.mjs` is the ESM build the HOST uses through the import map;
`markdown-it.min.js` is the UMD build an ARTIFACT uses from inside its frame.
The frame has an opaque origin, so the same rule that forces `mermaid.min.js` to
be the IIFE build forces this: a CLASSIC `<script src>` loads there, a MODULE one
is CORS-gated and blocked, and `fetch` is blocked too — so the `.mjs` cannot be
reached from in there at all. Both are the same upstream 15.0.0 and must stay
that way, because host and guest render the same markdown and may not disagree
about it. **Update them together or not at all.**

**The UMD build carries no version banner, so the record is its hash.** The
`.mjs` says `markdown-it 15.0.0` on its first line and a test reads it back;
`dist/browser/markdown-it.umd.min.js` starts straight in on the wrapper and says
nothing about itself. What was checked instead, at vendoring time, is that the
`.mjs` beside it is byte-identical to the one already here — same tarball, same
version — and the copy's own hash was written down:

```
npm pack markdown-it@15.0.0 && tar xzf markdown-it-15.0.0.tgz
sha256  dist/browser/markdown-it.esm.min.mjs  eb0a6cb2beb08326ea4d3e0e3b25ac72c1e6f119a619d9bbe061e72000ffa118  (== markdown-it.mjs on disk)
sha256  dist/browser/markdown-it.umd.min.js   8d0f6aca8f4de3321b6d07e03286176c59ec19b7b84abb6eb31f0fa795e83abc  (== markdown-it.min.js on disk)
```

**And it was checked in a browser, which is the only check that counts here.**
Headless Chrome, an iframe with `sandbox="allow-scripts"` and no
`allow-same-origin`, a classic `<script src>` at the file and the result posted
back out: `location.origin` was `"null"`, `typeof window.markdownit` was
`"function"`, and `markdownit().render("# hi")` came back `"<h1>hi</h1>\n"`. The
control ran in the same frame — a MODULE `<script src>` at `markdown-it.mjs`
failed with *blocked by CORS policy: ... from origin 'null'*, which is the whole
reason the UMD copy exists.

**The UMD copy is reached by absolute URL, not by the import map.** It is
`/vendor/markdown-it.min.js` written out in full by whoever builds the frame's
HTML — an artifact's document is `srcdoc` in an opaque origin and has no import
map of its own, and adding an entry to the host's would do nothing for it. So
there is no second line in `client/index.html`, and the bare-specifier story
below is unchanged.

**The `.d.mts` is ours and covers only what we call.** Upstream's own
declarations import those same three packages, so they are no more usable than
the Node bundle. Reaching for a markdown-it method that is not declared is the
signal to add it deliberately — not to widen the file to `any`.

**One `markdown-it.LICENSE` covers both markdown-it files.** It is upstream's
`LICENSE` verbatim — one MIT notice for the whole package, not a per-build one —
so a second copy beside the UMD file would be the same bytes under a different
name. Verified against the 15.0.0 tarball: identical.

**Nothing here is patched, ever.** A patched vendor file is a fork nobody
remembers making. If one needs changing, wrap it in `client/` instead. The
`noto/` faces are the one set CONVERTED here — downscaled and re-encoded, every
frame and its timing Google's — and their section below carries the command
that makes them byte for byte, which is a recorded build step and not an edit.

**`markdown-it` is reached through an import map**, declared in
`client/index.html`. That keeps `import MarkdownIt from "markdown-it"` a BARE
specifier, which `tools/layers.mjs` already skips as a package — so vendoring
cost the layering rule nothing and there is no new edge in the graph. `bun` and
`tsc` resolve the same specifier through `paths` in `tsconfig.json`, pointed at
`./vendor/markdown-it` **without an extension**: naming the `.mjs` exactly makes
TypeScript typecheck 800 lines of minified bundle instead of reading the
declaration beside it.

**`mermaid.min.js` is SERVED BUT NOT SHIPPED, and that distinction is the whole
of its place here now.** No plugin in `guest/plugins/` draws a mermaid diagram
any more and a fresh vault gets none: the whole point of this format is a custom
drawing, so a figure is an inline `<svg>` a section writes and a diagram is that
same drawing of relationships — `vault/.agents/skills/biom-diagrams/SKILL.md`. What
stays is the route. A workspace that carries its own `plugins/mermaid.js` — a
vault owns every plugin it draws with, and a copy of a retired one is still a
copy it owns — reaches this file exactly as any section reaches `three`, and
nothing in the framework has to know. Deleting it would break those vaults
silently, which is the one thing `/vendor/` exists to avoid.

**It is the IIFE build, and it has to be.** A sandboxed frame has an opaque
origin: a MODULE `<script src>` is CORS-gated and blocked, while a CLASSIC one
loads. Measured, not assumed — see `tests/vendor.test.ts`. The ESM builds
shipped alongside it (`mermaid.esm.mjs`, `mermaid.core.mjs`) cannot be loaded
from an artifact and are deliberately not vendored.

**Why serving beats bundling here.** `client/` is plain JavaScript a browser
loads directly, and a transpile step between *Claude Code writes the file* and
*you press reload* breaks the loop this instrument exists to demonstrate. A
served file keeps that true. It also means only the pages that want a diagram
pay for one, and the browser caches it across every frame on the page.

To update one: `npm pack <name>@<version>`, copy the same dist file out, update
the version above, and run the tests. Do not add a dependency to
`package.json` — the framework has no runtime dependencies, and what that file declares is build and test tooling.

## `noto/` — Jev's faces, Google's animated Noto emoji

**The faces Jev puts on a chat's messages and on its name are Google's animated
Noto emoji, and ONLY the ones on Jev's two lists are here.** The lists are
`STATUS_FACES`, `NAME_FACES` and `NAME_FALLBACK` in `server/domain/jev.ts`;
each file is `noto/<code>.webp`, where `<code>` is Google's own name for the
emoji — hex code points joined by `_`, `1f635_200d_1f4ab` for 😵‍💫 — and a
`Face`'s `art` is `/vendor/noto/<code>.webp`. Nothing is fetched while the
program runs: the server serves these from here, and the compiled application
carries them because `tools/app.ts` walks `vendor/` whole. A face added to a
list without its file here fails `tests/jev-faces.test.ts`, and so does a file
here that no list names.

**CC BY 4.0, © Google, and CHANGED — which the licence requires us to say.**
`noto/LICENSE` is the attribution: who made them, where they came from, the
licence and its link, and what was done to them. `NOTICE` at the root carries
the same entry beside the other licences. The licence's own legal code is
linked rather than copied, which Section 3(a)(1)(C) allows.

**These files are CONVERTED here, not copied, and the command reproduces them
byte for byte.** Google publishes each animated emoji as `512.webp`,
`512.gif` and `lottie.json`, at 512 px and no other size. The WebPs run from
100 KB to 1.1 MB each — the twenty-six status faces alone came to 14 MB — for a
face the look draws at 26 px. Lottie is small but needs a player, which is a
runtime dependency in the box. So each face is taken at 512 px and brought down
to **64 px**, twice the largest size it is drawn at, as an animated WebP:

```
curl -sfo <code>.gif https://fonts.gstatic.com/s/e/notoemoji/latest/<code>/512.gif
ffmpeg -i <code>.gif -vf scale=64:64:flags=area -fps_mode passthrough \
  -c:v libwebp_anim -pix_fmt yuva420p -lossless 0 -quality 75 -compression_level 6 -loop 0 \
  vendor/noto/<code>.webp
```

with ffmpeg 6.1.1 (Ubuntu `7:6.1.1-3ubuntu5`) on libwebp 1.3.2 (`1.3.2-0.4build3`).
**The source is the GIF and not the WebP because this ffmpeg cannot decode an
animated WebP** — its decoder refuses the `ANIM` chunk — and the GIF is
Google's own rendering of the same animation: 🤔 is 60 frames over 1.8 s in
both, 🧐 is 3.06 s with its long first frame in both. An area downscale of a
GIF also undoes its two weaknesses — the palette's dithering and the one-bit
transparency average out into smooth colour and a soft edge. `-fps_mode
passthrough` keeps every frame's own duration; libwebp drops a frame only where
it is identical to the one before and adds its time to that one.

**It was checked in a browser, which is the check that counts.** Headless
Chromium decoded every file with `ImageDecoder`: all 46 are animated, 64 × 64,
from 16 to 109 frames, and drawn at 26 px and 64 px on a light and a dark ground
they keep their alpha with no fringe.

**46 files, 2,748,228 bytes (2.6 MiB).** The status faces are 26, the name
topics 19, and the name's fallback one. What was fetched, on 2026-09-26:

```
sha256  0e1140d826ba66668f9bd1533076ffad39a668d3691c05d1f2e8cc9932c736fd  1f308/512.gif
sha256  2aacac0d7c2e0fab7984b00af7f566d2c584684eb6dc67dcfd6e7835abebf291  1f3ac/512.gif
sha256  f04196f858edb2d6eff07b8d30c083fad67b88bae0a8f1d3bc90b52a89c5ac46  1f3af/512.gif
sha256  ad976fcda3039a72df0d0512973bd23617ed84d2a770d265d6d5ae89a14bd54d  1f41b/512.gif
sha256  b42b175b8aec3388116fd9b0b707134a753d52a91bba17b34ea0729494f10b12  1f4a1/512.gif
sha256  f40e01b774b13cbb2a759772ea6a0e80013ac460078b1732f7995e8731ac4f13  1f4ac/512.gif
sha256  7e683cae9ac113122844641f6d805b0345be9f3e9447303ab47ef415590b38bb  1f4b8/512.gif
sha256  b677116d9ab1bd49fb21c46c4835585582736c5e7c6166d36969594292a4dea5  1f4ca/512.gif
sha256  e8986893187553ee2125d87097755b56db8184777b3274acc3cd1a5c54421898  1f4da/512.gif
sha256  caedbbf2420c2992ace9601ebd8dd91a9ac7b469b98011327f665c33bd050d0e  1f4e3/512.gif
sha256  f0a0c17008b9645ad1d51474095dac72974ac7c6f11342007218417d18e991d7  1f50e/512.gif
sha256  58b5c0f727b7a8830c54719192affd781e1e105787f98b15c6cf2384f0c78d83  1f605/512.gif
sha256  2e459b56d402b8a6d3a11a9a5ba275f9a52cd3894f235e0f846871f1d9e26a4c  1f60c/512.gif
sha256  9bc24379d9d52a3a863f7a7bd53bef063cd8651fd90e3a035fcb710897c75ad5  1f60e/512.gif
sha256  23d99f31df9dfc50b26458a6717c0bb0e148848355df96a9af0cd1b59aea4b8f  1f615/512.gif
sha256  2f0d9ffff8f1a0c41a932dd1a05ff2e40c16cdf4c06d2e9310c7b7256118d216  1f616/512.gif
sha256  35f44f0f6500e25599934505649246417601049eaed3a7d71b5e1fe52d9b6f8e  1f624/512.gif
sha256  61618a76fc5302fb293225a32fd2deab33444ed7b16e74a6421a5c14568a30aa  1f62c/512.gif
sha256  3799b8ae7ac9b586f7c2870d93391a81626eada8252b06115e0780cb6d21469f  1f62e/512.gif
sha256  f1d355e6aa8590c5cd6d73533f112fc858b25f5eca83397615e62240c587d243  1f630/512.gif
sha256  a9b8b73c95385d121fd476e0aca68337001b423ba352c5d7c12c8b462977b6d8  1f634/512.gif
sha256  95f6edc404b8dc5654e11b7f11789c929e3707ff8604a67d06a67eb1ecc952bd  1f635_200d_1f4ab/512.gif
sha256  5bcc294302522f5a06e87c420b84997e3705e4590063102bd6b59e75afd88777  1f636/512.gif
sha256  dc5457e7069616197af14038dade02e871633f677f92a0732806dec6ae0da8a1  1f642/512.gif
sha256  d644d67d81484688452b5d4bc1f79e98333a33b4fe4c03283839dd9008f19a5f  1f680/512.gif
sha256  403a9c533d5807f8ed9a8dfde0f1386ab05ae92147a4c586bca24e8cce34ee95  1f6a8/512.gif
sha256  f3376d3e38d97c3ed34e905cc6b27ab647628b8b9b1d9cd0639e7d54b96be523  1f6e0_fe0f/512.gif
sha256  3fed18946e5ad5aecb4a4964c166aed43f030fc8939c7d4e74be024d243c7b50  1f913/512.gif
sha256  cc4b16879b5f7264a37d7000783776b817b2f8f9e8084672c01d0849ab1bd27c  1f914/512.gif
sha256  2a53e434118916a967f30b9968d1e3fd3cf6a4978d39bdb3551c9fb4c8c1fccf  1f916/512.gif
sha256  0a5ebe458903d3122eb4cf5426e7718b3740e4c60934cb2e5aa83c54ab4ce3a9  1f91d/512.gif
sha256  d8a9ab199ba3e63e2a809b062e7cf69536fd7947132c0966d66f322358b48f65  1f928/512.gif
sha256  3a057adcb1fba20116436fb1892da7bade652a16039fa5bee74cdf15f075bec5  1f929/512.gif
sha256  021a790d5e4f989cbf59cdf83180de6cd80de4dc3cca7666a3bb33a81da97342  1f92f/512.gif
sha256  2b43f0712d60a909117c8bc17646f1d7f9bfb94dad8641fa9a9ea91715baf4e4  1f972/512.gif
sha256  ed5fe5ed4b9f79aa558c263a83d00986e8dced828b244a3265f4ab684425a777  1f973/512.gif
sha256  c88d93908ea536c0cc4454a4b26f2c85b2af06d20e15ea34d00ead91da24cca2  1f975/512.gif
sha256  f57402d67c3c2658e6fed2ff0e925f73f8004c05464c899dd1fe7eb598c9b2ec  1f97a/512.gif
sha256  cc9d488b467e677d09293a29fcb29e6e5494c434d142faae7cb6799a183097ca  1f9d0/512.gif
sha256  4a0c538f4979a0219aedbb4750f40f42c5141d47dd6bd608a32950998ab7bcd2  1f9f9/512.gif
sha256  0d7216134ede842a3cacd4a6744832514842b8813d01cb76bef35ec4180ef54d  1fae0/512.gif
sha256  4d80cec45d0bece98e93a8a8491c363792328ee4015714f1ea44923a8f24dd64  1fae1/512.gif
sha256  540a820bd92ca3264e0538f216d70c3ea8937efac695b13a9e8fd8b4c5cd1f4e  1fae3/512.gif
sha256  58aa869756d8aedb480809ac1185c375891b5675d718509453bdf3beee5fd605  23f0/512.gif
sha256  26b86563634ff8889e992ea48a03adc4656e8e43cc0cb5d7bc9087c766866ddd  270d_fe0f/512.gif
sha256  e598e4b90f9f6206ab6316defd43ef3305c14ebbb03840b09dca8f8685888261  2728/512.gif
```

What ships, which `tests/jev-faces.test.ts` reads back against the disk:

```
sha256  871f213be0e38e59c3b8dc3a2695843ea40fa19787f9717f8409e51ce2de832a  noto/1f308.webp
sha256  c67b3ae380114a02e0e36b3165dd6fc054ed9a2188eaf44e4d378034e01ca425  noto/1f3ac.webp
sha256  09adedee2cc331ffbf1d68c92092e9d590ced272c095535e5247ec116b83a2bd  noto/1f3af.webp
sha256  66d4eb500b52e633c9efc7d4eb031610f86cc358da2275cca2015e64f21d160c  noto/1f41b.webp
sha256  c14bfac860523c2778d79aab8d556b92a97c3206c79b7800883675860be94171  noto/1f4a1.webp
sha256  4260b863b48499c364e1e0a4a40329f06e4e7b8329a725dc82a5db401e0124fd  noto/1f4ac.webp
sha256  f750ebca45ca2e69e73b0f7bfc9642e1c6e1b69dbb5d754244c7112ec6da1ac4  noto/1f4b8.webp
sha256  626f886927e212501a5216a8127d0b51409202308480445a265d73560cf0747f  noto/1f4ca.webp
sha256  bccfd3d364b0513a54eb18b7548af573fd89327ed61b3db6a29d09182dcbb19d  noto/1f4da.webp
sha256  62e1da9c664da8698777b18f212ba55ac1325153bd3f6654afb777ad01119661  noto/1f4e3.webp
sha256  3042f3afc30a2ec2906ccb734274cca4b3a8784f8bb77c4b6f9d675e4fc42f2d  noto/1f50e.webp
sha256  d2fc25bfec74c7181aa2cadc9bd66b8a1cf8dbd5a03313dc2c5b9731833c34e5  noto/1f605.webp
sha256  98213d1cde88df4b76a2395df52ebcdee5991e11286984ea626b7b2f69440d6e  noto/1f60c.webp
sha256  a67702ac33a8f649a8cefc25ec7fdc93d60c5130dd7d50958dc68c49ae2dc0e9  noto/1f60e.webp
sha256  bebbae5dbc1c4f5950bd4b1209e87e8fbc256f1981ad39c8b9b6a78b05c023ba  noto/1f615.webp
sha256  228267ffcc0d500018ef97cedaeb02dd41464b35d97911a477f6ea1a4be2184b  noto/1f616.webp
sha256  3ffac9c1112151d2bf8a2a963b79835e2e004e281f6f02b4e7fe11dc45c447ad  noto/1f624.webp
sha256  d9e4657e78f2aa3e924b71d69ac28f51e361d62ae89147183e0937eb2e29d62a  noto/1f62c.webp
sha256  bf60d86a87d67faa9153c6cc638d25601ea6f41be4045dd4a47193ca49143d36  noto/1f62e.webp
sha256  a23fabff7cab217c4b49cad66eb8baf5322114b6cc747f61af9f67db196d64dd  noto/1f630.webp
sha256  62fc1312f958b34235a11376142c6699574663fefb466705ce437b33b5d5149e  noto/1f634.webp
sha256  182a6a4d1d2a49df07dfcc6808abdbf6187e5aca67174751fad0ce955894b14e  noto/1f635_200d_1f4ab.webp
sha256  f6d84e9055ba801689b96bfe74f39dafad6d53e61b005df9c7b28530891a0c33  noto/1f636.webp
sha256  4b9ccdfd008e8be1cf8fc365b254b2fa434bd3062ca951966e95b3e1d013941c  noto/1f642.webp
sha256  304896e9969bb17ad008b63e0ba3e01838af0fa8273de1f691c83bed901c95eb  noto/1f680.webp
sha256  d9e886eaf9a93674632a5b0ba8045dbf00bc43747c376df40860bb339ee26753  noto/1f6a8.webp
sha256  ea295234177317474feab5a0a1139d59445bfdc0b621f0b818b5965bae194c05  noto/1f6e0_fe0f.webp
sha256  ee273bdb6889c4878d63eb495abb14dee7b1ecada85269016566776e23b9250f  noto/1f913.webp
sha256  35720b00fb59adc1a8fe2bfa845295fd06fe64c1241da3bd4de5926f677cc015  noto/1f914.webp
sha256  105d3ae4785cce96d8c57ac8c731cdf14ee94693d76693365e78d7c8373d6150  noto/1f916.webp
sha256  192e12982e15604430c854cabe817e410267c9000ce53e6b5b172ffc501bf8d9  noto/1f91d.webp
sha256  a920eb9939db03de86e8a63a73bec9d68117e4d065a96ed3269f2fd8f32ffabd  noto/1f928.webp
sha256  84254c56c056961e8ea55a9d7714a7c70fdd6ddc2652e8909cd499ea34af90a8  noto/1f929.webp
sha256  1c9dc44e4e172ff19f800bf6a0a518437afd3a65b98107de8187f7dbb172754e  noto/1f92f.webp
sha256  2ea766a90ccf4eb4b85948a77cdd6d5ac8566e0106df70890070a401fef274d1  noto/1f972.webp
sha256  6745f5ce23175cf1623a90b98d3ae2db099b57387b077c637aa64f6fdbdda4f9  noto/1f973.webp
sha256  1b50d06091e9208b62523128758d4858305209b5f6f8a33da3f38bf0efd15e9d  noto/1f975.webp
sha256  9a4a4c61e7ade2821de00c242b937c3ca9229b6d2d6de867491d7876464b64ce  noto/1f97a.webp
sha256  8d3d869ab23c1314a917137427d1697a176f687c87dd696f171dd8b26339b670  noto/1f9d0.webp
sha256  9495aa3c748dfc7b87348a9e90bd5a6e06727100f179b72ea92a8b39f42ba682  noto/1f9f9.webp
sha256  50e2b2e130bcae99b5a9d64065ba6714bb2900bf5034b1d73d420ec91c2ce83f  noto/1fae0.webp
sha256  9dde7ba10c2e56885e6e4351131ca1a6ca7aa99cc4bc73874b01ab78850797aa  noto/1fae1.webp
sha256  5fc85d554ec24d2fbc0e2215f4d1166c0c7210123349d4197d7376c4e4cfff30  noto/1fae3.webp
sha256  37d307e8d1eb6e8931c8e57e314ac35bc12aae4a1c7ba424fc049157d722b368  noto/23f0.webp
sha256  07465ae3a40e25bd14b8f3fda5ff5e9e06f42de805385b583b08f7277d1dd0d5  noto/270d_fe0f.webp
sha256  b9e5cac37256f8aaff676aa5af7db8c903569a4dd5848655abfee3c6ffe7dbb0  noto/2728.webp
```

To change the list: fetch and convert the new face with the two commands above,
add both of its lines here, add it to `server/domain/jev.ts`, and add it to
nothing else — `NOTICE` and `noto/LICENSE` already cover every file in
`noto/`. `latest` is Google's word for the current drawing, so a face fetched
later may not be this one; its source hash says which it was.

// The demo's clock: what every scenario shares about time. A scenario's own
// beats are in its file under scenarios/; this is only the arithmetic and the
// length of the loop, which the GIF and the stage must agree on.

export const FPS = 15;
export const DURATION = 8;      // seconds; the GIF loops on this
export const LOOP_FROM = 7.8;   // cross-fade back to the opening composition

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));

/** 0 before `a`, 1 after `b`, eased out between. */
export const seg = (t, a, b) => {
  const x = clamp((t - a) / (b - a));
  return 1 - Math.pow(1 - x, 3);
};

/** How much of `tail` is typed at `t`, typing from `from` to `to`. */
export const typed = (t, tail, from, to) => {
  const x = clamp((t - from) / (to - from));
  return tail.slice(0, Math.round(x * tail.length));
};

/** Three dots lit in turn, the input's "working" lamp, as a function of t:
 *  one is always lit, so no frame reads as stalled. */
export const dots = (t) => [0, 1, 2]
  .map((i) => (((t - i * 0.3) % 0.9) + 0.9) % 0.9 < 0.3 ? `<i class="on"></i>` : `<i></i>`)
  .join("");

export const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

/** Shows an element at opacity `o`, nudged down by `dy` px while it arrives. */
export const show = (el, o, dy = 0) => {
  if (!el) return;
  el.style.opacity = String(o);
  el.style.transform = dy ? `translateY(${dy.toFixed(2)}px)` : "";
  el.style.visibility = o <= 0.001 ? "hidden" : "visible";
};

export const LABEL = "Illustrative demo · time compressed";

// SPDX-License-Identifier: AGPL-3.0-only
// One ApiRequest to the server, one ApiResponse back.
//
// It is a pipe. It knows no URL vocabulary beyond API_ROUTE, no HTTP verbs
// above it, no status codes above it, and nothing at all about what a request
// means — the envelope is already the message, which is why there is one route
// and not a REST surface. That is what makes the swap in the build plan real:
// fetch → postMessage → a network client is a new file next to this one and one
// changed line in boot.js, and its two importers (store/, bridge/) never learn.
//
// It never throws. A failed call comes back as an ApiResponse with ok:false,
// because a pipe that throws makes every caller write a try/catch around a type
// that already has a failure case inside it.

/** @import { ApiRequest, ApiResponse, HostError, Transport } from "../../contracts/types.ts" */

import { API_ROUTE, CALL_TIMEOUT, ERRORS, fail } from "../../contracts/wire.js";

/** WHAT THE TOKEN IS CALLED ON THE ADDRESS, and the client's only copy of it.
 *
 *  IT CANNOT COME OUT OF `contracts/`. The token is an ADDRESS rather than a
 *  message — `wire.js` argues that at the vault prefix, and it is why an artifact
 *  cannot set one — so `contracts/` has no type and no constant for it, and
 *  `contracts/` is frozen outside a barrier anyway. There is no other module both
 *  the server and the client may import: `layers.json` puts `contracts` at 0 and
 *  nothing else is reachable from both tiers.
 *
 *  SO IT IS SPELLED TWICE AND NOT FOUR TIMES. `TOKEN_PARAM` in `server/main.ts`
 *  is the other copy, and it names this one. `client/boot.js` takes it from here,
 *  because it is a layer above and the shared thing belongs in the lower of the
 *  two. */
export const TOKEN_PARAM = "token";

/**
 * @param {string} baseUrl "" in the framework — the client is served by the same
 *   process it calls. It is a parameter so that pointing the client at another
 *   host is an argument in boot.js rather than an edit in here.
 * @param {string | null} [token] THE PER-LAUNCH TOKEN, when there is one. The
 *   built application's server mints one at boot and the window is opened at an
 *   address carrying it; a server run from source mints none and this is null.
 *
 *   IT RIDES ON THE REQUEST AND NEVER IN THE ENVELOPE, exactly as the vault
 *   prefix does — and for the same reason `wire.js` gives there. `ApiRequest` is
 *   a strict superset of `HostRequest`, so a field on the envelope is a field an
 *   artifact could set, and an artifact has no business holding the key to the
 *   process hosting it. So this is the whole client-side change, and `contracts/`
 *   has no type for it.
 * @returns {Transport}
 */
export function makeHttp(baseUrl, token = null) {
  const url = baseUrl + API_ROUTE + (token === null || token === "" ? "" : `?${TOKEN_PARAM}=${encodeURIComponent(token)}`);

  return {
    async call(req) {
      /** @type {Response} */
      let res;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(req),
          // Without this a hung request hangs the surface that awaited it, with
          // nothing on screen to say so. The demo failure this actually catches
          // is the server being restarted underneath a running page.
          signal: AbortSignal.timeout(CALL_TIMEOUT),
        });
      } catch {
        return broken(req, "the server did not answer");
      }

      /** @type {unknown} */
      let body;
      try {
        body = await res.json();
      } catch {
        return broken(req, `the server answered ${res.status} with something that was not a response`);
      }

      // A well-formed failure travels as a body, so the status is not consulted:
      // the server answering 400 with a real envelope is the normal error path,
      // and only a body that is not an envelope at all is the transport's
      // problem — a proxy's HTML error page, or the wrong process on the port.
      if (isResponse(body)) return body;
      return broken(req, `the server answered ${res.status} with something that was not a response`);
    },
  };
}

/**
 * @param {unknown} v
 * @returns {v is ApiResponse}
 */
function isResponse(v) {
  if (typeof v !== "object" || v === null) return false;
  const r = /** @type {Record<string, unknown>} */ (v);
  return typeof r.id === "string" && typeof r.ok === "boolean";
}

/**
 * The envelope is echoed back so a caller correlating on `id` is not a special
 * case for failures. `internal` is the honest code: the closed enumeration has
 * no "the host's own transport failed", and `fetch_failed` already means the
 * artifact's outbound fetch, which this is not.
 * @param {ApiRequest} req
 * @param {string} message
 * @returns {ApiResponse}
 */
function broken(req, message) {
  return {
    id: req.id,
    g: req.g,
    ok: false,
    error: /** @type {HostError} */ (fail(ERRORS.INTERNAL, message)),
  };
}

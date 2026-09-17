// SPDX-License-Identifier: AGPL-3.0-only
// The terminal route, on a real server with a real shell behind it.
//
// Spawned rather than imported, as `vendor.test.ts` is, because the route table
// and the cookie on the composed document are exactly what is being checked.
// What this proves that the unit tests cannot: the document served to this
// machine carries the capability, a socket with it and this server's own Origin
// gets a shell IN THE WORKSPACE'S FOLDER, the socket without either gets
// nothing, and the shell goes when the server does.

import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HERE = join(import.meta.dir, "..");
const unix = process.platform !== "win32";

let vault = "";
let data = "";
let port = 0;
let proc: ReturnType<typeof Bun.spawn> | null = null;
let base = "";
let cookie = "";

beforeAll(async () => {
  if (!unix) return;
  vault = realpathSync(mkdtempSync(join(tmpdir(), "biom-term-vault-")));
  data = mkdtempSync(join(tmpdir(), "biom-term-data-"));
  rmSync(vault, { recursive: true, force: true });
  port = 4900 + Math.floor(Math.random() * 500);
  base = `http://127.0.0.1:${port}`;
  proc = Bun.spawn(["bun", "run", join(HERE, "server", "main.ts")], {
    cwd: HERE,
    env: { ...process.env, PORT: String(port), VAULT: vault, VAULTS: join(data, "vaults.json"), SHELL: "/bin/sh", HOME: data },
    stdout: "ignore",
    stderr: "ignore",
  });
  for (let i = 0; i < 200; i++) {
    try {
      const res = await fetch(`${base}/`);
      const set = res.headers.get("set-cookie") ?? "";
      cookie = set.split(";")[0] ?? "";
      await res.text();
      return;
    } catch {
      await Bun.sleep(50);
    }
  }
  throw new Error("the framework did not come up");
});

afterAll(() => {
  proc?.kill();
  if (vault) rmSync(vault, { recursive: true, force: true });
  if (data) rmSync(data, { recursive: true, force: true });
});

const route = () => `ws://127.0.0.1:${port}/v/${encodeURIComponent(vault)}/terminal`;

/** Open a socket, and answer whether it opened. */
function tryOpen(headers: Record<string, string>): Promise<WebSocket | null> {
  return new Promise((resolve) => {
    const ws = new WebSocket(route(), { headers } as unknown as string[]);
    ws.binaryType = "arraybuffer";
    const t = setTimeout(() => resolve(null), 4000);
    ws.onopen = () => {
      clearTimeout(t);
      resolve(ws);
    };
    ws.onerror = () => {
      clearTimeout(t);
      resolve(null);
    };
  });
}

test.if(unix)("the composed document hands this machine the capability, HttpOnly and SameSite=Strict", async () => {
  const res = await fetch(`${base}/`);
  const set = res.headers.get("set-cookie") ?? "";
  await res.text();
  expect(set).toContain(`biom-terminal-${port}=`);
  expect(set).toContain("HttpOnly");
  expect(set).toContain("SameSite=Strict");
  // A static file carries nothing.
  const css = await fetch(`${base}/css/terminal.css`);
  expect(css.headers.get("set-cookie")).toBeNull();
  await css.text();
});

test.if(unix)("without the capability, or from another origin, no socket opens", async () => {
  const origin = `http://127.0.0.1:${port}`;
  expect(await tryOpen({ origin })).toBeNull();
  expect(await tryOpen({ origin: "null", cookie })).toBeNull();
  expect(await tryOpen({ origin: "https://example.com", cookie })).toBeNull();
  // A plain request to the route is not an upgrade.
  const plain = await fetch(route().replace("ws:", "http:"), { headers: { origin, cookie } });
  expect(plain.status).toBe(403);
  await plain.text();
});

test.if(unix)("with both, a shell starts in the workspace's folder, answers, and ends", async () => {
  const ws = await tryOpen({ origin: `http://127.0.0.1:${port}`, cookie });
  expect(ws).not.toBeNull();
  const socket = ws as WebSocket;
  const events: any[] = [];
  let out = "";
  socket.onmessage = (e) => {
    if (typeof e.data === "string") events.push(JSON.parse(e.data));
    else {
      const bytes = new Uint8Array(e.data as ArrayBuffer);
      out += new TextDecoder().decode(bytes.subarray(2 + (bytes[1] ?? 0)));
    }
  };
  const until = async (what: string, ok: () => boolean) => {
    for (let i = 0; i < 300 && !ok(); i++) await Bun.sleep(25);
    if (!ok()) throw new Error(`never: ${what}\n${out}\n${JSON.stringify(events)}`);
  };

  socket.send(JSON.stringify({ op: "hello" }));
  await until("the session list", () => events.some((e) => e.ev === "sessions"));
  socket.send(JSON.stringify({ op: "create", nonce: "route-test", cols: 90, rows: 25 }));
  await until("the shell", () => events.some((e) => e.ev === "created"));
  const id = events.find((e) => e.ev === "created").session.id;
  expect(events.find((e) => e.ev === "created").session.cwd).toBe(vault);

  socket.send(JSON.stringify({ op: "input", id, data: "pwd; echo marker-$((6*7))\r" }));
  await until("the shell answered", () => out.includes("marker-42"));
  expect(out).toContain(vault);

  socket.send(JSON.stringify({ op: "end", id }));
  await until("the exit", () => events.some((e) => e.ev === "state" && e.session.id === id && e.session.state === "exited"));
  socket.close();
});

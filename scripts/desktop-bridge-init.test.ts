import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";

test("desktop bridge releases an approved quit after an invocation rejection", async () => {
  const source = await Bun.file(
    new URL("../desktop/src-tauri/src/main.rs", import.meta.url),
  ).text();
  const script = source.match(
    /const INIT_SCRIPT: &str = r#"([\s\S]*?)"#;/,
  )?.[1];
  if (!script) throw new Error("Desktop initialization script not found");

  let invoke = () => Promise.resolve("ok");
  const document = { documentElement: { inert: false } };
  const window = {
    location: { origin: "https://betterbox.kevinjbridgelal.workers.dev" },
    __TAURI_INTERNALS__: { invoke: () => invoke() },
    addEventListener: () => {},
    top: undefined as unknown,
  };
  window.top = window;
  runInNewContext(script, { window, document });
  const bridge = (
    window as unknown as {
      __KB_ONEMAIL_DESKTOP__: {
        request: (action: string, payload: object) => Promise<string>;
      };
    }
  ).__KB_ONEMAIL_DESKTOP__;

  const failure = new Error("stale response");
  invoke = () => Promise.reject(failure);
  const rejected = bridge.request("quit-response", { allow: true });
  expect(document.documentElement.inert).toBe(true);
  await expect(rejected).rejects.toBe(failure);
  expect(document.documentElement.inert).toBe(false);

  invoke = () => Promise.resolve("ok");
  await expect(bridge.request("quit-response", { allow: true })).resolves.toBe(
    "ok",
  );
  expect(document.documentElement.inert).toBe(true);

  invoke = () => Promise.reject(failure);
  for (const [action, payload] of [
    ["quit-response", { allow: false }],
    ["ready", {}],
  ] as const) {
    await expect(bridge.request(action, payload)).rejects.toBe(failure);
    expect(document.documentElement.inert).toBe(true);
  }
});

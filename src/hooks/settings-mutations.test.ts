import { afterEach, expect, test } from "bun:test";
import { deleteSnippet } from "./use-snippets";
import { assignSignature, removeSignature } from "./use-signatures";
import { updateSettings } from "./use-settings";
const originalFetch=globalThis.fetch;
afterEach(()=>{globalThis.fetch=originalFetch;});
test("rejected settings writes cannot masquerade as successful deletions or assignments",async()=>{
  updateSettings({demoMode:false});
  globalThis.fetch=(async()=>Response.json({error:"Permission denied"},{status:403})) as unknown as typeof fetch;
  await expect(deleteSnippet("id")).rejects.toThrow();
  await expect(removeSignature("id")).rejects.toThrow();
  await expect(assignSignature("account","signature")).rejects.toThrow();
});

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { v7 as uuidv7 } from "uuid";
import { NextRequest } from "next/server";
import { openContentDatabase, type ContentDatabase } from "../src/server/content";
import { SQLiteAdminIdentityRepository } from "../src/server/admin-auth";
import { GET, PUT } from "../src/app/api/admin/local/ai/agent-1/instructions/route";
import { GET as HISTORY } from "../src/app/api/admin/local/ai/agent-1/instructions/history/route";
import { POST as COUNT } from "../src/app/api/admin/local/ai/agent-1/instructions/count/route";
const url = "http://localhost:3000/api/admin/local/ai/agent-1/instructions";
const headers = { Host: "localhost:3000", Origin: "http://localhost:3000", "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" };
const section = () => ({ id: uuidv7(), title: "هوية", description: "PRIVATE_ADMIN", body: "<rules>مرحبا</rules>", enabled: true });
async function fixture(run: (database: ContentDatabase) => Promise<void>) {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-instruction-api-"));
  const globals = globalThis as typeof globalThis & { __pythagorasContentDatabase?: ContentDatabase };
  const previous = globals.__pythagorasContentDatabase;
  const database = openContentDatabase({ dataDirectory: root, migrationsDirectory: path.join(process.cwd(), "drizzle") });
  new SQLiteAdminIdentityRepository(database).createInitialOwner({ id: uuidv7(), email: `${uuidv7()}@example.test`, displayName: "API fixture", passwordHash: "fixture", createdAt: 1_900_000_000_000 });
  globals.__pythagorasContentDatabase = database;
  try { await run(database); } finally { if (previous) globals.__pythagorasContentDatabase = previous; else delete globals.__pythagorasContentDatabase; database.close(); rmSync(root, { recursive: true, force: true }); }
}
const put = (body: unknown, extra = {}) => PUT(new NextRequest(url, { method: "PUT", headers: { ...headers, ...extra }, body: JSON.stringify(body) }));
const count = (body: unknown, extra = {}) => COUNT(new NextRequest(url + "/count", { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify(body) }));
test("Admin read/count preserves no-policy state and never exposes content publicly", async () => fixture(async (database) => {
  const read = await GET(new NextRequest(url, { headers })); assert.equal(read.status, 200); assert.equal((await read.json()).current, null); assert.match(read.headers.get("cache-control") ?? "", /no-store/);
  const counted = await count({ sections: [section()] }); assert.equal(counted.status, 200); const body = await counted.json(); assert.equal(body.result.total.precision, "estimated"); assert.equal(JSON.stringify(body).includes("PRIVATE_ADMIN"), false); assert.equal(JSON.stringify(body).includes("<rules>"), false);
  assert.equal((database.client.prepare("SELECT count(*) n FROM ai_instruction_policies").get() as { n: number }).n, 0);
  assert.equal((await GET(new NextRequest(url, { headers: { Host: "evil.example" } }))).status, 403);
  assert.equal((await HISTORY(new NextRequest(url + "/history", { headers: { Host: "192.168.0.105:3000" } }))).status, 403);
}));
test("Publish returns immutable snapshot and rejects stale expectedRevision without losing authored content", async () => fixture(async (database) => {
  const sections = [section()];
  const published = await put({ expectedRevision: 0, sections, enabled: true }); assert.equal(published.status, 200); const first = (await published.json()).current; assert.equal(first.revision, 1); assert.deepEqual(first.sections, sections); assert.ok(!first.instructions.includes("PRIVATE_ADMIN"));
  const stale = await put({ expectedRevision: 0, sections: [{ ...sections[0], body: "stale" }], enabled: true }); assert.equal(stale.status, 409); assert.equal((await stale.json()).code, "AI_POLICY_CONFLICT");
  const read = await GET(new NextRequest(url, { headers })); assert.equal((await read.json()).current.instructions, first.instructions);
  assert.equal((database.client.prepare("SELECT count(*) n FROM ai_instruction_policy_revisions").get() as { n: number }).n, 1);
  assert.equal((await count({ revision: 1 })).status, 200); assert.equal((await count({ revision: 999 })).status, 404);
  const history = await HISTORY(new NextRequest(url + "/history", { headers })); assert.equal(history.status, 200); assert.equal((await history.json()).revisions[0].actorName, "Local Admin Operator");
}));
test("Cross-origin mutations/counting are forbidden and browser actor/policy/compiler identity is rejected", async () => fixture(async () => {
  const draft = { expectedRevision: 0, sections: [section()], enabled: true };
  assert.equal((await put(draft, { Origin: "https://evil.example" })).status, 403);
  assert.equal((await count({ sections: draft.sections }, { Origin: "https://evil.example" })).status, 403);
  assert.equal((await count({ sections: draft.sections }, { Host: "192.168.0.105:3000", Origin: "http://192.168.0.105:3000" })).status, 403);
  for (const field of ["actorId", "scope", "subjectKey", "policyId", "instructions", "compiledHash", "compilerVersion"]) assert.equal((await put({ ...draft, [field]: "browser-controlled" })).status, 400);
  assert.equal((await count({ sections: draft.sections, apiKey: "browser-key" })).status, 400);
}));
test("Malformed sections/revision selectors/oversized requests fail safely without publication", async () => fixture(async () => {
  assert.equal((await put({ sections: [section()], enabled: true })).status, 400);
  assert.equal((await put({ expectedRevision: 0, sections: [section()], enabled: "yes" })).status, 400);
  assert.equal((await put({ expectedRevision: 0, sections: [{ ...section(), body: "" }], enabled: true })).status, 400);
  assert.equal((await count({ revision: 1, sections: [section()] })).status, 400);
  assert.equal((await count({ revision: 1.5 })).status, 400);
  assert.equal((await HISTORY(new NextRequest(url + "/history?before=bad", { headers }))).status, 400);
  assert.equal((await put({ expectedRevision: 0, sections: [{ ...section(), body: "x".repeat(65 * 1024) }], enabled: true })).status, 400);
}));

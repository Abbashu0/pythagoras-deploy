import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, readFileSync, copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { v7 as uuidv7 } from "uuid";
import { compileInstructionSections, instructionBytes, instructionCountKey, validateInstructionSections, InstructionSectionError, type InstructionSection } from "../src/lib/ai-instruction-sections";
import { compileInstructionAuthoring, instructionHash, instructionRevisionSections } from "../src/server/ai/policy/instruction-compiler";
import { normalizeAIInstructionPolicyContent } from "../src/server/ai/policy/instruction-validation";
import { AIInstructionAdminService } from "../src/server/ai/policy/instruction-admin-service";
import { AIPolicyError } from "../src/server/ai/policy/errors";
import { openContentDatabase } from "../src/server/content";
import { SQLiteAdminIdentityRepository } from "../src/server/admin-auth";
import type { AdminActor } from "../src/server/admin-auth/contracts";
import { isCurrentInstructionCount } from "../src/components/admin/ai/use-instruction-count";
const section = (patch: Partial<InstructionSection> = {}): InstructionSection => ({ id: uuidv7(), title: "هوية المساعد", description: "للإدارة فقط", body: "  مرحبًا\n<instructions>نص عربي</instructions>\n```json\n{\"role\":\"tutor\"}\n```\n$x^2$\n", enabled: true, ...patch });
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-instructions-"));
  const database = openContentDatabase({ dataDirectory: root, migrationsDirectory: path.join(process.cwd(), "drizzle") });
  const owner = new SQLiteAdminIdentityRepository(database).createInitialOwner({ id: uuidv7(), email: `${uuidv7()}@example.test`, displayName: "Instruction fixture", passwordHash: "fixture-only", createdAt: 1_900_000_000_000 });
  const actor: AdminActor = { actorUserId: owner.id, actorRole: "OWNER" };
  const service = new AIInstructionAdminService(database, () => 1_900_000_000_100);
  return { database, service, actor, root, close() { database.close(); rmSync(root, { recursive: true, force: true }); } };
}
test("Compiler V1 preserves exact Arabic/XML/code/math and excludes descriptions/IDs", () => {
  const a = section(); const b = section({ title: "الثانية", body: "second\r\n", description: "PRIVATE", enabled: true }); const disabled = section({ title: "disabled", body: "NEVER_SEND", enabled: false });
  const result = compileInstructionAuthoring([a, disabled, b]);
  assert.equal(result.instructions, `## ${a.title}\n${a.body}\n\n## ${b.title}\n${b.body}`);
  assert.equal(result.authoring.compilerVersion, 1); assert.equal(result.authoring.compiledHash, instructionHash(result.instructions));
  assert.ok(!result.instructions.includes(a.description)); assert.ok(!result.instructions.includes(a.id)); assert.ok(!result.instructions.includes("NEVER_SEND"));
  assert.equal(compileInstructionSections([a, disabled, b]).parts.map((part) => part.text).join(""), result.instructions);
  assert.equal(compileInstructionSections([a, disabled, b]).parts[1].text, "");
});
test("Reordering changes the prompt and hash, metadata-only edits do not", () => {
  const a = section(), b = section({ title: "ثانية" });
  assert.notEqual(compileInstructionAuthoring([a, b]).authoring.compiledHash, compileInstructionAuthoring([b, a]).authoring.compiledHash);
  assert.equal(compileInstructionAuthoring([a]).instructions, compileInstructionAuthoring([{ ...a, description: "new metadata" }]).instructions);
  assert.equal(instructionCountKey([a]), instructionCountKey([{ ...a, description: "new metadata" }]));
});
for (const [name, value] of [
  ["duplicate IDs", (() => { const a = section(); return [a, { ...a }]; })()],
  ["invalid IDs", [section({ id: "bad" })]], ["empty enabled title", [section({ title: " " })]], ["empty enabled body", [section({ body: " " })]],
  ["too many sections", Array.from({ length: 25 }, () => section())], ["long title", [section({ title: "x".repeat(121) })]],
  ["long description", [section({ description: "x".repeat(481) })]], ["oversized body", [section({ body: "x".repeat(32 * 1024 + 1) })]],
  ["control character", [section({ body: "x\u0000" })]], ["C1 control character", [section({ body: "x\u0081" })]], ["lone surrogate", [section({ body: "\ud800" })]],
  ["all disabled", [section({ enabled: false })]], ["unknown fields", [{ ...section(), instructions: "injected" }]],
] as const) test(`publication rejects ${name}`, () => assert.throws(() => validateInstructionSections(value, true), InstructionSectionError));
test("Drafts may be incomplete; disabled empty sections contribute nothing", () => {
  assert.doesNotThrow(() => validateInstructionSections([section({ body: "", title: "" })]));
  assert.doesNotThrow(() => validateInstructionSections([section(), section({ title: "", body: "", enabled: false })], true));
  assert.equal(instructionBytes("مرحبا"), 10);
  assert.throws(() => validateInstructionSections([section({ body: "x".repeat(16 * 1024) }), section({ body: "y".repeat(16 * 1024) }), section({ body: "z" })], true), /32 KiB/);
});
test("Legacy six-field content accepts XML and preserves text rather than normalizing it", () => {
  const text = "  <rules>مرحبا ﷲ</rules>\r\n";
  const result = normalizeAIInstructionPolicyContent({ key: "global", scope: "GLOBAL", subjectKey: null, displayName: "Legacy", instructions: text, enabled: true });
  assert.equal(result.instructions, text); assert.equal(Object.hasOwn(result, "authoring"), false);
  const structured = compileInstructionAuthoring([section()]);
  assert.throws(() => normalizeAIInstructionPolicyContent({ ...result, ...structured, instructions: "tampered" }), AIPolicyError);
});
test("Local draft/preview/count never creates a policy; publication snapshots sections atomically", () => {
  const f = fixture();
  try {
    assert.equal(f.service.current(), null); assert.deepEqual(f.service.history().revisions, []);
    const authored = [section(), section({ enabled: false, body: "" })]; compileInstructionAuthoring(authored, false);
    assert.equal(f.service.current(), null);
    const first = f.service.publish({ sections: authored, enabled: true, actor: f.actor, expectedRevision: 0 });
    assert.equal(first.revision, 1); assert.equal(first.activeSections, 1); assert.deepEqual(first.sections, authored); assert.equal(first.actorName, "Instruction fixture");
    authored[0].body = "LOCAL EDIT";
    assert.notEqual(f.service.current()?.instructions, compileInstructionSections(authored).text);
    const second = f.service.publish({ sections: authored, enabled: false, actor: f.actor, expectedRevision: 1 });
    assert.equal(second.revision, 2); assert.equal(second.enabled, false); assert.equal(f.service.repository.getRevision(first.policyId, 1)?.instructions, first.instructions);
    assert.equal(second.summary.changed, 1); assert.equal(second.summary.enabledChanged, true);
    assert.throws(() => f.service.publish({ sections: authored, enabled: true, actor: f.actor, expectedRevision: 1 }), (error: unknown) => error instanceof AIPolicyError && error.code === "AI_POLICY_CONFLICT");
    assert.equal(f.service.history().revisions.length, 2);
    assert.throws(() => f.database.client.prepare("UPDATE ai_instruction_policy_revisions SET instructions = ? WHERE policy_id = ?").run("edit", first.policyId));
    assert.throws(() => f.database.client.prepare("DELETE FROM ai_instruction_policy_revisions WHERE policy_id = ?").run(first.policyId));
    const restored = f.service.publish({ sections: first.sections, enabled: true, actor: f.actor, expectedRevision: 2 });
    assert.equal(restored.revision, 3); assert.equal(restored.instructions, first.instructions); assert.equal(f.service.history(3).revisions[0].revision, 2);
  } finally { f.close(); }
});
test("Legacy revision bytes are unchanged, have a stable derived section, and restore as a NEW structured revision", () => {
  const f = fixture();
  try {
    const text = "  <identity>السابق</identity>\r\n";
    const original = f.service.repository.create({ id: uuidv7(), actor: f.actor, now: 1_900_000_000_050, content: { key: "legacy.global", scope: "GLOBAL", subjectKey: null, displayName: "تعليمات قديمة", instructions: text, enabled: true } });
    const draft = instructionRevisionSections(original);
    assert.equal(draft[0].id, original.policyId); assert.equal(draft[0].body, text); assert.deepEqual(draft, instructionRevisionSections(original));
    assert.equal(f.service.current()?.legacy, true);
    const next = f.service.publish({ sections: draft, enabled: true, actor: f.actor, expectedRevision: 1 });
    assert.equal(next.revision, 2); assert.equal(next.legacy, false); assert.equal(next.instructions, `## ${draft[0].title}\n${text}`);
    assert.equal(f.service.repository.getRevision(original.policyId, 1)?.instructions, text); assert.equal(f.service.repository.getRevision(original.policyId, 1)?.authoring, undefined);
  } finally { f.close(); }
});
test("Migration is additive and keeps revision immutability, consistency guard and historical tables", () => {
  const sql = readFileSync(path.join(process.cwd(), "drizzle/0050_instruction_section_authoring.sql"), "utf8");
  assert.ok(!/DROP TABLE|DELETE FROM|UPDATE ai_instruction/iu.test(sql)); assert.equal((sql.match(/ALTER TABLE/gu) ?? []).length, 3);
  const f = fixture();
  try {
    assert.equal(f.database.client.prepare("PRAGMA foreign_key_check").all().length, 0);
    assert.equal(f.database.client.prepare("PRAGMA integrity_check").get() && Object.values(f.database.client.prepare("PRAGMA integrity_check").get()!)[0], "ok");
    const revision = f.service.publish({ sections: [section()], enabled: true, expectedRevision: 0, actor: f.actor });
    assert.throws(() => f.database.client.prepare("INSERT INTO ai_instruction_policy_revisions (id, policy_id, revision, display_name, instructions, enabled, created_at, created_by, compiler_version) VALUES (?, ?, 2, 'bad', 'bad', 1, ?, ?, 1)").run(uuidv7(), revision.policyId, revision.createdAt, f.actor.actorUserId), /invalid instruction authoring/);
    assert.throws(() => f.service.repository.appendRevision({ id: revision.policyId, expectedRevision: 1, actor: f.actor, now: revision.createdAt, content: { key: "changed", scope: "GLOBAL", subjectKey: null, displayName: "wrong", enabled: true, ...compileInstructionAuthoring([section()]) } }), AIPolicyError);
    assert.equal(f.service.history().revisions.length, 1);
  } finally { f.close(); }
});
test("A long valid legacy prompt restores without an artificially smaller per-section body limit", () => {
  const f = fixture();
  try {
    const text = "x".repeat(28 * 1024);
    const original = f.service.repository.create({ id: uuidv7(), actor: f.actor, now: 1_900_000_000_050, content: { key: "legacy.long", scope: "GLOBAL", subjectKey: null, displayName: "Legacy", instructions: text, enabled: true } });
    const next = f.service.publish({ sections: instructionRevisionSections(original), enabled: true, actor: f.actor, expectedRevision: 1 });
    assert.equal(next.sections[0].body, text); assert.equal(next.instructions, `## Legacy\n${text}`);
    assert.equal(f.service.repository.getRevision(original.policyId, 1)?.instructions, text);
  } finally { f.close(); }
});
test("Stale token results cannot overwrite newer edits or a later model-basis refresh", () => {
  assert.equal(isCurrentInstructionCount("old", "new", 1, 2), false); assert.equal(isCurrentInstructionCount("same", "same", 1, 2), false); assert.equal(isCurrentInstructionCount("same", "same", 2, 2), true);
});
test("0050 upgrades populated pre-authoring revisions byte-for-byte without rewriting policy identities", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-instruction-upgrade-"));
  const priorMigrations = path.join(root, "prior-migrations");
  mkdirSync(path.join(priorMigrations, "meta"), { recursive: true });
  const journal = JSON.parse(readFileSync(path.join(process.cwd(), "drizzle/meta/_journal.json"), "utf8")) as { entries: Array<{ tag: string; idx: number }>; [key: string]: unknown };
  const priorEntries = journal.entries.filter((entry) => entry.idx < 50);
  for (const entry of priorEntries) copyFileSync(path.join(process.cwd(), "drizzle", entry.tag + ".sql"), path.join(priorMigrations, entry.tag + ".sql"));
  writeFileSync(path.join(priorMigrations, "meta/_journal.json"), JSON.stringify({ ...journal, entries: priorEntries }));
  let database: ReturnType<typeof openContentDatabase> | undefined;
  try {
    database = openContentDatabase({ dataDirectory: root, migrationsDirectory: priorMigrations });
    const actor = new SQLiteAdminIdentityRepository(database).createInitialOwner({ id: uuidv7(), email: `${uuidv7()}@example.test`, displayName: "Migration actor", passwordHash: "fixture", createdAt: 1_900_000_000_000 });
    const id = uuidv7(); const revisionId = uuidv7(); const original = "  ﷲ <legacy>الهوية</legacy>\r\n";
    database.client.prepare("INSERT INTO ai_instruction_policies (id,key,scope,subject_key,current_revision,created_at,updated_at,created_by,updated_by) VALUES (?, 'legacy-global', 'GLOBAL', NULL, 1, ?, ?, ?, ?)").run(id, actor.createdAt, actor.createdAt, actor.id, actor.id);
    database.client.prepare("INSERT INTO ai_instruction_policy_revisions (id,policy_id,revision,display_name,instructions,enabled,created_at,created_by) VALUES (?, ?, 1, 'Legacy', ?, 1, ?, ?)").run(revisionId, id, original, actor.createdAt, actor.id);
    const before = database.client.prepare("SELECT hex(instructions) hex FROM ai_instruction_policy_revisions WHERE id=?").get(revisionId) as { hex: string };
    database.close(); database = undefined;
    database = openContentDatabase({ dataDirectory: root, migrationsDirectory: path.join(process.cwd(), "drizzle") });
    const after = database.client.prepare("SELECT hex(instructions) hex,sections_json,compiler_version,compiled_hash FROM ai_instruction_policy_revisions WHERE id=?").get(revisionId) as { hex: string; sections_json: null; compiler_version: null; compiled_hash: null };
    assert.equal(after.hex, before.hex); assert.equal(after.sections_json, null); assert.equal(after.compiler_version, null); assert.equal(after.compiled_hash, null);
    assert.equal(new AIInstructionAdminService(database).current()?.policyId, id); assert.equal(new AIInstructionAdminService(database).current()?.instructions, original);
    assert.equal((database.client.prepare("SELECT count(*) n FROM __drizzle_migrations").get() as { n: number }).n, journal.entries.length);
    assert.throws(() => database!.client.prepare("UPDATE ai_instruction_policy_revisions SET display_name='changed' WHERE id=?").run(revisionId));
    assert.equal(database.client.prepare("PRAGMA foreign_key_check").all().length, 0);
  } finally { database?.close(); rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 }); }
});

import { eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { AdminActor } from "../../admin-auth/contracts";
import type { ContentDatabase } from "../../content/database";
import { adminUsers } from "../../content/schema";
import { SQLiteAIInstructionPolicyRepository } from "./instruction-repository";
import { compileInstructionAuthoring, instructionRevisionSections } from "./instruction-compiler";
import { AIPolicyError } from "./errors";
import type { AIInstructionPolicyRevision } from "./instruction-contracts";
import { instructionHash } from "./instruction-compiler";

export class AIInstructionAdminService {
  readonly repository: SQLiteAIInstructionPolicyRepository;
  constructor(private readonly database: ContentDatabase, private readonly now = Date.now) { this.repository = new SQLiteAIInstructionPolicyRepository(database); }
  current() {
    const policy = this.repository.getByScope("GLOBAL", null);
    if (!policy) return null;
    return this.present(this.repository.getCurrentRevision(policy.id)!);
  }
  history(before?: number) {
    const policy = this.repository.getByScope("GLOBAL", null);
    const revisions = policy ? this.repository.listRevisions(policy.id, before) : [];
    return { revisions: revisions.map((revision) => this.present(revision)), nextBefore: revisions.length === 20 ? revisions.at(-1)!.revision : null };
  }
  publish(input: { expectedRevision: number; sections: unknown; enabled: boolean; actor: AdminActor }) {
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || typeof input.enabled !== "boolean") throw new AIPolicyError("AI_POLICY_INVALID", "A valid expectedRevision and enabled state are required.");
    const compiled = compileInstructionAuthoring(input.sections);
    return this.database.client.transaction(() => {
      const current = this.repository.getByScope("GLOBAL", null);
      if ((current?.currentRevision ?? 0) !== input.expectedRevision) throw new AIPolicyError("AI_POLICY_CONFLICT", "تغيّر الإصدار المنشور. مسودتك محفوظة؛ راجع آخر إصدار قبل النشر.", { currentRevision: current?.currentRevision ?? 0 });
      const content = { key: current?.key ?? "agent-1.general", scope: "GLOBAL" as const, subjectKey: null, displayName: current?.displayName ?? "تعليمات Agent 1 العامة", enabled: input.enabled, ...compiled };
      const args = { id: current?.id ?? uuidv7(), content, actor: input.actor, now: this.now() };
      const revision = current ? this.repository.appendRevision({ ...args, expectedRevision: input.expectedRevision }) : this.repository.create(args);
      return this.present(revision);
    }).immediate();
  }
  private present(revision: AIInstructionPolicyRevision) {
    const actor = this.database.db.select({ displayName: adminUsers.displayName }).from(adminUsers).where(eq(adminUsers.id, revision.createdBy)).get();
    const prior = revision.revision > 1 ? this.repository.getRevision(revision.policyId, revision.revision - 1) : null;
    const sections = instructionRevisionSections(revision);
    const previous = prior ? instructionRevisionSections(prior) : [];
    const added = sections.filter((section) => !previous.some((item) => item.id === section.id)).length;
    const removed = previous.filter((section) => !sections.some((item) => item.id === section.id)).length;
    const changed = sections.filter((section) => { const item = previous.find((entry) => entry.id === section.id); return item && JSON.stringify(item) !== JSON.stringify(section); }).length;
    const reordered = sections.filter((section) => previous.some((item) => item.id === section.id)).map((section) => section.id).join(",") !== previous.filter((section) => sections.some((item) => item.id === section.id)).map((section) => section.id).join(",");
    return { ...revision, compiledHash: revision.authoring?.compiledHash ?? instructionHash(revision.instructions), sections, legacy: !revision.authoring, actorName: actor?.displayName ?? "مدير سابق", activeSections: revision.authoring ? sections.filter((section) => section.enabled).length : 1, summary: { added, removed, changed, reordered, enabledChanged: prior !== null && prior.enabled !== revision.enabled } };
  }
}
export type InstructionAdminRevision = NonNullable<ReturnType<AIInstructionAdminService["current"]>>;

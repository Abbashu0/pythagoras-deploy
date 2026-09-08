import type { AdminActor } from "../admin-auth/contracts";
import {
  createChangeManagementService,
  type ChangeSetDetails,
} from "../change-management";
import { getContentDatabase } from "../content";

/**
 * The Admin surface may offer a fast "Save and publish" action for an OWNER,
 * but the canonical write still follows the normal Change Set lifecycle. This
 * keeps the audit/publication boundary intact while avoiding a second manual
 * screen for the low-risk local configuration workflow.
 */
export function publishAIAdminChange(input: {
  title: string;
  description?: string;
  resourceType: string;
  resourceId: string;
  expectedRevision: number;
  desired: unknown;
  operation?: "CREATE" | "UPDATE";
  actor: AdminActor;
}): { details: ChangeSetDetails; publicationRevision: number } {
  if (input.actor.actorRole !== "OWNER") {
    throw new Error("Only an OWNER may publish AI Admin configuration.");
  }

  // Build against the request's active database. This also keeps isolated
  // Admin route tests from retaining a closed fixture database through a
  // process-global Change Management singleton.
  const service = createChangeManagementService(getContentDatabase());
  const submitted = service.createChangeSet(
    {
      title: input.title,
      description: input.description,
      submit: true,
      initialItem: {
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        expectedRevision: input.expectedRevision,
        desired: input.desired,
        operation: input.operation,
      },
    },
    input.actor,
  );
  const approved = service.approve(
    submitted.changeSet.id,
    submitted.changeSet.revision,
    input.actor,
  );
  const published = service.publish(
    approved.changeSet.id,
    approved.changeSet.revision,
    input.actor,
  );
  return {
    details: published.changeSet,
    publicationRevision: published.publicationRevision,
  };
}

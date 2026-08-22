import { ReviewWorkspace } from "@/components/admin/review/ReviewWorkspace";

export default async function AdminReviewDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReviewWorkspace initialChangeSetId={id}/>;
}

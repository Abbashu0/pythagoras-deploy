import { QuestionPackageEditorWorkspace } from "@/components/admin/questions/QuestionPackageEditorWorkspace";

export default async function QuestionPackagePage({ params }: { params: Promise<{ packageId: string }> }) {
  const { packageId } = await params;
  return <QuestionPackageEditorWorkspace packageId={packageId} />;
}

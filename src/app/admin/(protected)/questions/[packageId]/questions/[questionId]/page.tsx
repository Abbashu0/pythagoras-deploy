import { QuestionEditorWorkspace } from "@/components/admin/questions/QuestionEditorWorkspace";

export default async function QuestionPage({ params, searchParams }: { params: Promise<{ packageId: string; questionId: string }>; searchParams: Promise<{ order?: string }> }) {
  const { packageId, questionId } = await params;
  const requestedOrder = Number((await searchParams).order);
  const initialOrder = Number.isSafeInteger(requestedOrder) && requestedOrder > 0 ? requestedOrder : 1;
  return <QuestionEditorWorkspace packageId={packageId} questionId={questionId} initialOrder={initialOrder} />;
}

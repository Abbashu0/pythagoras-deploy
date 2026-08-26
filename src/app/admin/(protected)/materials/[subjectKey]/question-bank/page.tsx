import { MaterialQuestionBankWorkspace } from "@/components/admin/material-question-bank/MaterialQuestionBankWorkspace";

export default async function MaterialQuestionBankPage({ params }: { params: Promise<{ subjectKey: string }> }) {
  const { subjectKey } = await params;
  return <MaterialQuestionBankWorkspace subjectKey={subjectKey} />;
}

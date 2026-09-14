"use client";

import { useParams, useSearchParams } from "next/navigation";
import { QuestionEditorWorkspace } from "@/components/admin/questions/question-editor-workspace";

export default function NewQuestionPage() {
  const params = useParams<{ packageId: string }>();
  const searchParams = useSearchParams();
  const packageId = Array.isArray(params.packageId) ? params.packageId[0] : params.packageId;
  return <QuestionEditorWorkspace packageId={packageId} questionId={null} fromSubjectKey={searchParams.get("fromSubjectKey")} fromNodeId={searchParams.get("fromNodeId")} />;
}

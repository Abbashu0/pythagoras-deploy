"use client";

import { useParams, useSearchParams } from "next/navigation";
import { QuestionEditorWorkspace } from "@/components/admin/questions/question-editor-workspace";

export default function QuestionEditorPage() {
  const params = useParams<{ packageId: string; questionId: string }>();
  const searchParams = useSearchParams();
  const packageId = Array.isArray(params.packageId) ? params.packageId[0] : params.packageId;
  const questionId = Array.isArray(params.questionId) ? params.questionId[0] : params.questionId;
  return <QuestionEditorWorkspace packageId={packageId} questionId={questionId} fromSubjectKey={searchParams.get("fromSubjectKey")} fromNodeId={searchParams.get("fromNodeId")} />;
}

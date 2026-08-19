import { FileQuestion } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function AdminQuestionsPage() {
  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6 lg:px-8" dir="rtl">
      <Card className="max-w-2xl">
        <CardHeader className="flex-row items-center gap-3 space-y-0">
          <FileQuestion className="h-5 w-5 text-primary" />
          <CardTitle>بنك الأسئلة قيد البناء</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          سيُبنى نظام بنك الأسئلة الجديد لاحقًا بعد توفير البيانات والمواصفات.
        </CardContent>
      </Card>
    </div>
  );
}

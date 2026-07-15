import ExamRunner from "./ExamRunner";

export default async function ExamPage({
  params,
}: {
  params: Promise<{ examId: string }>;
}) {
  const { examId } = await params;
  return <ExamRunner examId={examId} />;
}

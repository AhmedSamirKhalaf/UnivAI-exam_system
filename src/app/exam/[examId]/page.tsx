import ExamRunner from "./ExamRunner";

export default async function ExamPage({
  params,
}: {
  params: Promise<{ examId: string }>;
}) {
  const { examId } = await params;
  // Where the student goes after submitting — results live in UnivAI, not here.
  const returnUrl = process.env.UNIVAI_APP_URL ?? "http://localhost:3100";
  return <ExamRunner examId={examId} returnUrl={returnUrl} />;
}

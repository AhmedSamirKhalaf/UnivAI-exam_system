import ExamRunner from "./ExamRunner";
import { isStandalone, verifyStandaloneToken } from "@/lib/runtime";
import { notFound } from "next/navigation";

export default async function ExamPage({
  params,
  searchParams,
}: {
  params: Promise<{ examId: string }>;
  searchParams: Promise<{ dev_token?: string }>;
}) {
  const { examId } = await params;
  const { dev_token: devToken } = await searchParams;
  if (isStandalone() && !verifyStandaloneToken(devToken ?? null)) notFound();
  // Where the student goes after submitting — results live in UnivAI, not here.
  const returnUrl = process.env.UNIVAI_APP_URL ?? "http://localhost:3100";
  return <ExamRunner examId={examId} returnUrl={returnUrl} devToken={devToken} />;
}

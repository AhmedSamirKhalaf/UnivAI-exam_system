import { NextRequest, NextResponse } from "next/server";
import { questions } from "@/app/data/questions";

export async function POST(req: NextRequest) {
  const { answers }: { answers: Record<string, string> } = await req.json();

  let correct = 0;
  const results = questions.map((q) => {
    const userAnswer = answers[q.id] || null;
    const isCorrect = userAnswer === q.correctAnswer;
    if (isCorrect) correct++;
    return { id: q.id, text: q.text, correctAnswer: q.correctAnswer, userAnswer, isCorrect };
  });

  const total = questions.length;
  const grade = Math.round((correct / total) * 100);

  return NextResponse.json({ grade, correct, total, results });
}

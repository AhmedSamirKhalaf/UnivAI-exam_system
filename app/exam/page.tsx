"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Container from "@mui/material/Container";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import CircularProgress from "@mui/material/CircularProgress";
import Alert from "@mui/material/Alert";
import QuestionCard from "@/app/components/QuestionCard";
import QuestionList from "@/app/components/QuestionList";

interface Question {
  id: string;
  text: string;
  options: { label: string; value: string }[];
}

export default function ExamPage() {
  const router = useRouter();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [seenIndices, setSeenIndices] = useState<number[]>([0]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/questions")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load questions");
        return res.json();
      })
      .then((data: Question[]) => {
        setQuestions(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  const goNext = useCallback(() => {
    if (currentIndex >= questions.length - 1) return;
    const next = currentIndex + 1;
    setCurrentIndex(next);
    setSeenIndices((prev) => (prev.includes(next) ? prev : [...prev, next]));
  }, [currentIndex, questions.length]);

  const goPrev = useCallback(() => {
    if (currentIndex <= 0) return;
    setCurrentIndex(currentIndex - 1);
  }, [currentIndex]);

  const selectQuestion = useCallback((index: number) => {
    setCurrentIndex(index);
  }, []);

  const handleAnswer = useCallback(
    (value: string) => {
      setAnswers((prev) => ({ ...prev, [currentIndex]: value }));
    },
    [currentIndex]
  );

  const handleEndExam = useCallback(() => {
    const answersPayload: Record<string, string> = {};
    for (const [idx, val] of Object.entries(answers)) {
      answersPayload[questions[Number(idx)].id] = val;
    }
    sessionStorage.setItem("exam-answers", JSON.stringify(answersPayload));
    router.push("/result");
  }, [answers, questions, router]);

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh" }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Container maxWidth="sm" sx={{ py: 4 }}>
        <Alert severity="error">{error}</Alert>
      </Container>
    );
  }

  const q = questions[currentIndex];
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === questions.length - 1;

  return (
    <Box sx={{ minHeight: "100vh" }}>
      <AppBar position="static" color="default" variant="outlined">
        <Toolbar sx={{ justifyContent: "space-between" }}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            Exam
          </Typography>
          <Button variant="contained" color="error" onClick={handleEndExam}>
            End Exam
          </Button>
        </Toolbar>
      </AppBar>

      <Container maxWidth="lg" sx={{ py: 3 }}>
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "200px 1fr" }, gap: 3 }}>
          <Box sx={{ alignSelf: "start", display: { xs: "none", md: "block" } }}>
            <QuestionList
              total={questions.length}
              seenIndices={seenIndices}
              currentIndex={currentIndex}
              answers={answers}
              onSelect={selectQuestion}
            />
          </Box>

          <Box>
            <QuestionCard
              questionNumber={currentIndex + 1}
              text={q.text}
              options={q.options}
              selectedAnswer={answers[currentIndex] ?? null}
              onAnswer={handleAnswer}
            />
            <Box sx={{ display: "flex", gap: 2, mt: 2 }}>
              <Button variant="outlined" fullWidth disabled={isFirst} onClick={goPrev}>
                Previous
              </Button>
              {!isLast ? (
                <Button variant="contained" fullWidth onClick={goNext}>
                  Next
                </Button>
              ) : (
                <Button variant="contained" color="error" fullWidth onClick={handleEndExam}>
                  End Exam
                </Button>
              )}
            </Box>
          </Box>
        </Box>
      </Container>
    </Box>
  );
}

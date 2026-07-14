"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Container from "@mui/material/Container";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import LinearProgress from "@mui/material/LinearProgress";
import CircularProgress from "@mui/material/CircularProgress";
import Alert from "@mui/material/Alert";
import Divider from "@mui/material/Divider";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";

interface GradedQuestion {
  id: string;
  text: string;
  correctAnswer: string;
  userAnswer: string | null;
  isCorrect: boolean;
}

interface ExamResult {
  grade: number;
  correct: number;
  total: number;
  results: GradedQuestion[];
}

export default function ResultPage() {
  const router = useRouter();
  const [result, setResult] = useState<ExamResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const raw = sessionStorage.getItem("exam-answers");
    if (!raw) {
      router.push("/");
      return;
    }

    fetch("/api/end-exam", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers: JSON.parse(raw) }),
    })
      .then((res) => res.json())
      .then((data: ExamResult) => {
        setResult(data);
        setLoading(false);
        sessionStorage.removeItem("exam-answers");
      })
      .catch(() => {
        setLoading(false);
      });
  }, [router]);

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh" }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!result) {
    return (
      <Container maxWidth="sm" sx={{ py: 4 }}>
        <Alert severity="error">Something went wrong.</Alert>
      </Container>
    );
  }

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Card variant="outlined">
        <CardContent>
          <Typography variant="h5" sx={{ fontWeight: 700 }} gutterBottom>
            Thank you for taking the exam!
          </Typography>

          <Box sx={{ textAlign: "center", my: 3 }}>
            <Typography variant="h2" sx={{ fontWeight: 700 }} color="success.main">
              {result.grade}%
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {result.correct} out of {result.total} correct
            </Typography>
            <LinearProgress
              variant="determinate"
              value={result.grade}
              color={result.grade >= 60 ? "success" : "error"}
              sx={{ mt: 2, height: 8, borderRadius: 4 }}
            />
          </Box>

          <Divider sx={{ mb: 2 }} />

          {result.results.map((r) => (
            <Box key={r.id} sx={{ py: 1 }}>
              <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
                {r.isCorrect ? (
                  <CheckCircleIcon fontSize="small" color="success" sx={{ mt: 0.3 }} />
                ) : (
                  <CancelIcon fontSize="small" color="error" sx={{ mt: 0.3 }} />
                )}
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {r.text}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {r.userAnswer
                      ? `Your answer: ${r.userAnswer.toUpperCase()}`
                      : "Skipped"}
                    {" \u2014 "}Correct: {r.correctAnswer.toUpperCase()}
                  </Typography>
                </Box>
              </Box>
              <Divider sx={{ mt: 1 }} />
            </Box>
          ))}

          <Button
            variant="contained"
            fullWidth
            size="large"
            sx={{ mt: 2 }}
            onClick={() => router.push("/")}
          >
            Back to Home
          </Button>
        </CardContent>
      </Card>
    </Container>
  );
}



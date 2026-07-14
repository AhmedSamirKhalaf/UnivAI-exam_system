"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import LinearProgress from "@mui/material/LinearProgress";
import CircularProgress from "@mui/material/CircularProgress";
import Alert from "@mui/material/Alert";

interface ExamResult {
  grade: number;
  correct: number;
  total: number;
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
      <Box sx={{ p: 4 }}>
        <Alert severity="error">Something went wrong.</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ minHeight: "100vh", display: "flex", justifyContent: "center", alignItems: "center", p: 3 }}>
      <Card variant="outlined" sx={{ maxWidth: 500, width: "100%" }}>
        <CardContent sx={{ textAlign: "center", p: 4 }}>
          <Typography variant="h5" sx={{ fontWeight: 700 }} gutterBottom>
            Thank you for taking the exam!
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Your answers have been submitted.
          </Typography>

          <Box sx={{ my: 3 }}>
            <Typography variant="h2" sx={{ fontWeight: 700 }} color="success.main">
              {result.correct} / {result.total}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              questions correct
            </Typography>
            <LinearProgress
              variant="determinate"
              value={result.grade}
              color={result.grade >= 60 ? "success" : "error"}
              sx={{ mt: 3, height: 10, borderRadius: 5 }}
            />
          </Box>

          <Button
            variant="contained"
            fullWidth
            size="large"
            onClick={() => router.push("/")}
          >
            Back to Home
          </Button>
        </CardContent>
      </Card>
    </Box>
  );
}

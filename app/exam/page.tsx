"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Container from "@mui/material/Container";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import CircularProgress from "@mui/material/CircularProgress";
import Alert from "@mui/material/Alert";
import Card from "@mui/material/Card";
import CardHeader from "@mui/material/CardHeader";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import QuestionCard from "@/app/components/QuestionCard";
import QuestionList from "@/app/components/QuestionList";
import EndExamDialog from "@/app/components/EndExamDialog";
import PermissionGate from "@/app/components/PermissionGate";
import useMonitor from "@/app/hooks/useMonitor";

interface Question {
  id: string;
  text: string;
  options: { label: string; value: string }[];
}

type Phase = "loading" | "permission" | "exam" | "ending";

export default function ExamPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("loading");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [seenIndices, setSeenIndices] = useState<number[]>([0]);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [micEnabled, setMicEnabled] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const monitorActive = phase === "exam";
  const { violations } = useMonitor(monitorActive, videoRef);

  // ---- fetch questions ----
  useEffect(() => {
    fetch("/api/questions")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load questions");
        return res.json();
      })
      .then((data: Question[]) => {
        setQuestions(data);
        setPhase("permission");
      })
      .catch((err) => {
        setError(err.message);
        setPhase("loading");
      });
  }, []);

  // ---- permission gate ----
  const handlePermissionReady = useCallback((mic: boolean) => {
    setMicEnabled(mic);
    if (mic) {
      const el = document.documentElement;
      const r = el.requestFullscreen || (el as any).webkitRequestFullscreen;
      if (r) r.call(el).catch(() => {});
    }
    setPhase("exam");
  }, []);

  // ---- navigation ----
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

  // ---- end exam ----
  const submitExam = useCallback(async () => {
    setDialogOpen(false);
    setPhase("ending");

    // exit fullscreen
    if (document.fullscreenElement) {
      try { await document.exitFullscreen(); } catch {}
    }

    // save violations
    try {
      await fetch("/api/violations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ violations }),
      });
    } catch {}

    // navigate
    const answersPayload: Record<string, string> = {};
    for (const [idx, val] of Object.entries(answers)) {
      answersPayload[questions[Number(idx)].id] = val;
    }
    sessionStorage.setItem("exam-answers", JSON.stringify(answersPayload));
    router.push("/result");
  }, [answers, questions, router, violations]);

  // ---- loading / error states ----
  if (phase === "loading") {
    if (error) {
      return (
        <Container maxWidth="sm" sx={{ py: 4 }}>
          <Alert severity="error">{error}</Alert>
        </Container>
      );
    }
    return (
      <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh" }}>
        <CircularProgress />
      </Box>
    );
  }

  // ---- permission phase ----
  if (phase === "permission") {
    return <PermissionGate onReady={handlePermissionReady} />;
  }

  // ---- ending phase ----
  if (phase === "ending") {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh" }}>
        <CircularProgress />
      </Box>
    );
  }

  const q = questions[currentIndex];
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === questions.length - 1;

  return (
    <Box sx={{ minHeight: "100vh" }}>
      <AppBar position="static" color="default" variant="outlined">
        <Toolbar sx={{ justifyContent: "space-between" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              Exam
            </Typography>
            {!micEnabled && (
              <Chip label="Mic Off" size="small" color="error" variant="outlined" />
            )}
          </Box>
          <Button variant="contained" color="error" onClick={() => setDialogOpen(true)}>
            End Exam
          </Button>
        </Toolbar>
      </AppBar>

      <Container maxWidth="lg" sx={{ py: 3 }}>
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "200px 1fr 250px" }, gap: 3 }}>
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
                <Button variant="contained" color="error" fullWidth onClick={() => setDialogOpen(true)}>
                  End Exam
                </Button>
              )}
            </Box>
          </Box>

          <Card variant="outlined" sx={{ display: { xs: "none", md: "flex" }, flexDirection: "column", alignSelf: "start" }}>
            <CardHeader title="Camera" slotProps={{ title: { variant: "subtitle2", color: "text.secondary" } }} sx={{ pb: 0 }} />
            <CardContent>
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                style={{ width: "100%", borderRadius: 8, background: "#0f172a" }}
              />
            </CardContent>
          </Card>
        </Box>
      </Container>

      <EndExamDialog open={dialogOpen} onConfirm={submitExam} onCancel={() => setDialogOpen(false)} />
    </Box>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormLabel from "@mui/material/FormLabel";
import LinearProgress from "@mui/material/LinearProgress";
import Paper from "@mui/material/Paper";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

/**
 * The exam-taking screen. Pure MUI: no CSS files.
 *
 * Questions are fetched ONE AFTER ANOTHER (not in bulk). Each fetched question
 * is cached on the client so the student can freely navigate between questions
 * that have already been fetched. A left sidebar shows all question numbers;
 * only fetched questions are clickable.
 *
 * Proctoring: leaving the tab, exiting fullscreen, copy/paste, and opening
 * DevTools are reported to the proctoring API while the exam is open.
 * Right-click and keyboard shortcuts that could open DevTools are blocked.
 */

type Question = {
  question_id: string;
  prompt: string;
  type: "mcq" | "essay";
  options?: string[];
};

type ExamMeta = {
  _id: string;
  type: "quiz" | "mid" | "final";
  title: string;
  student_id: string;
  taken: boolean;
  mark?: number;
  passing_mark?: number;
  passed: boolean;
  integrity_status: "clean" | "invalidated";
  question_count: number;
};

type Props = { examId: string; returnUrl: string };

export default function ExamRunner({ examId, returnUrl }: Props) {
  const [examMeta, setExamMeta] = useState<ExamMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [warnings, setWarnings] = useState(0);

  const [fetchedQuestions, setFetchedQuestions] = useState<Record<number, Question>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [fetchingQ, setFetchingQ] = useState(false);

  const examMetaRef = useRef<ExamMeta | null>(null);
  const fetchedRef = useRef<Record<number, Question>>({});
  const fetchingSet = useRef<Set<number>>(new Set());

  /* ------------------------------------------------------------------ */
  /*   Data fetching                                                     */
  /* ------------------------------------------------------------------ */

  const loadExamMeta = useCallback(async () => {
    try {
      const res = await fetch(`/api/exams/${examId}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load the exam.");
      setExamMeta(data);
      examMetaRef.current = data;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the exam.");
    }
  }, [examId]);

  const fetchQuestion = useCallback(
    async (index: number): Promise<boolean> => {
      if (fetchedRef.current[index]) return true;
      if (fetchingSet.current.has(index)) return false;

      fetchingSet.current.add(index);
      setFetchingQ(true);
      try {
        const res = await fetch(`/api/exams/${examId}?index=${index}`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to fetch question.");

        const q = data.generated_questions?.[0];
        if (!q) throw new Error("No question returned.");

        fetchedRef.current = { ...fetchedRef.current, [index]: q };
        setFetchedQuestions({ ...fetchedRef.current });
        return true;
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to fetch question."
        );
        return false;
      } finally {
        fetchingSet.current.delete(index);
        setFetchingQ(false);
      }
    },
    [examId]
  );

  // Load exam metadata on mount, then kick off the first question fetch.
  useEffect(() => {
    loadExamMeta();
  }, [loadExamMeta]);

  useEffect(() => {
    if (examMeta && examMeta.question_count > 0 && !fetchedRef.current[0]) {
      fetchQuestion(0);
    }
  }, [examMeta, fetchQuestion]);

  /* ------------------------------------------------------------------ */
  /*   Auto-prefetch next question when the current one is answered      */
  /* ------------------------------------------------------------------ */

  const currentQ = fetchedQuestions[currentIndex];
  const totalQuestions = examMeta?.question_count ?? 0;
  const isLastQuestion = currentIndex >= totalQuestions - 1;

  useEffect(() => {
    if (!examMeta || !currentQ) return;
    const answered = !!answers[currentQ.question_id]?.trim();
    if (answered && !isLastQuestion) {
      const nextIdx = currentIndex + 1;
      if (!fetchedRef.current[nextIdx]) {
        fetchQuestion(nextIdx);
      }
    }
  }, [
    answers,
    currentQ,
    currentIndex,
    isLastQuestion,
    examMeta,
    fetchQuestion,
  ]);

  /* ------------------------------------------------------------------ */
  /*   Proctoring                                                        */
  /* ------------------------------------------------------------------ */

  const report = useCallback(
    (
      type: "tab_switch" | "copy_paste" | "fullscreen_exit" | "devtools_open",
      metadata?: object
    ) => {
      const meta = examMetaRef.current;
      if (!meta || meta.taken) return;
      setWarnings((c) => c + 1);
      fetch(`/api/exams/${examId}/proctoring-event`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, student_id: meta.student_id, metadata }),
      }).catch(() => undefined);
    },
    [examId]
  );

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) report("tab_switch");
    };
    const onCopyPaste = (e: ClipboardEvent) =>
      report("copy_paste", { kind: e.type });
    const onFullscreen = () => {
      if (!document.fullscreenElement) report("fullscreen_exit");
    };

    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("copy", onCopyPaste);
    document.addEventListener("paste", onCopyPaste);
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("copy", onCopyPaste);
      document.removeEventListener("paste", onCopyPaste);
      document.removeEventListener("fullscreenchange", onFullscreen);
    };
  }, [report]);

  /* ------------------------------------------------------------------ */
  /*   DevTools detection & input blocking                               */
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    let devtoolsReported = false;

    const reportOnce = () => {
      if (!devtoolsReported) {
        devtoolsReported = true;
        report("devtools_open");
      }
    };

    // ---- 1. Block right-click context menu ----
    const onContextMenu = (e: MouseEvent) => e.preventDefault();

    // ---- 2. Block keyboard shortcuts that open DevTools / view source ----
    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toUpperCase();

      // F12
      if (e.key === "F12") { e.preventDefault(); return; }

      // Ctrl / Cmd + Shift + I / J / C / K  (DevTools / Console / Inspector / Network)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && ["I", "J", "C", "K"].includes(key)) {
        e.preventDefault(); return;
      }

      // Ctrl / Cmd + U  (view source)
      if ((e.ctrlKey || e.metaKey) && key === "U") {
        e.preventDefault(); return;
      }

      // Ctrl / Cmd + Shift + S  (save-as can be used to inspect)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && key === "S") {
        e.preventDefault(); return;
      }
    };

    // ---- 3. DevTools detection via console.dir getter trick ----
    //    When DevTools is open, console.dir accesses element properties
    //    to display them — triggering our getter.
    const probe = document.createElement("div");
    Object.defineProperty(probe, "id", {
      get() {
        reportOnce();
      },
    });

    const detectConsole = () => {
      // eslint-disable-next-line no-console
      console.dir(probe);
    };

    // ---- 4. DevTools detection via outer/inner dimension diff ----
    //    Docked DevTools shrink innerWidth or innerHeight while outer
    //    dimensions stay the same.
    const DIM_THRESHOLD = 160;
    let lastW = window.outerWidth;
    let lastH = window.outerHeight;

    const onResize = () => {
      const w = window.outerWidth;
      const h = window.outerHeight;
      const deltaW = Math.abs(w - lastW);
      const deltaH = Math.abs(h - lastH);
      lastW = w;
      lastH = h;

      // A large, sudden dimension change while the page is visible
      // strongly indicates DevTools being toggled on/off.
      if (deltaW > DIM_THRESHOLD || deltaH > DIM_THRESHOLD) {
        reportOnce();
      }
    };

    // ---- 5. Disable select / drag on the page to prevent copying content ----
    const onSelectStart = (e: Event) => e.preventDefault();
    const onDragStart = (e: Event) => e.preventDefault();

    document.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);
    document.addEventListener("selectstart", onSelectStart);
    document.addEventListener("dragstart", onDragStart);

    const interval = setInterval(detectConsole, 1500);

    return () => {
      document.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("selectstart", onSelectStart);
      document.removeEventListener("dragstart", onDragStart);
      clearInterval(interval);
    };
  }, [report]);

  /* ------------------------------------------------------------------ */
  /*   Navigation                                                        */
  /* ------------------------------------------------------------------ */

  const goNext = useCallback(async () => {
    if (isLastQuestion) return;
    const nextIdx = currentIndex + 1;
    const ok = await fetchQuestion(nextIdx);
    if (ok) setCurrentIndex(nextIdx);
  }, [currentIndex, isLastQuestion, fetchQuestion]);

  const goPrev = useCallback(() => {
    if (currentIndex > 0) setCurrentIndex(currentIndex - 1);
  }, [currentIndex]);

  const goToQuestion = useCallback(
    (index: number) => {
      if (fetchedRef.current[index]) setCurrentIndex(index);
    },
    []
  );

  /* ------------------------------------------------------------------ */
  /*   Submit                                                            */
  /* ------------------------------------------------------------------ */

  async function submit() {
    if (!examMeta) return;
    setSubmitting(true);
    setError(null);
    try {
      const student_answers = Array.from(
        { length: examMeta.question_count },
        (_, i) => ({
          question_id: `q_${i + 1}`,
          answer: answers[`q_${i + 1}`] ?? "",
        })
      );
      const res = await fetch(`/api/exams/${examId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ student_answers }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Submission failed.");

      const updated: ExamMeta = {
        ...examMeta,
        taken: true,
        mark: data.mark,
        passed: data.passed,
      };
      setExamMeta(updated);
      examMetaRef.current = updated;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed.");
    } finally {
      setSubmitting(false);
      setConfirmOpen(false);
    }
  }

  /* ------------------------------------------------------------------ */
  /*   Render – loading / error                                          */
  /* ------------------------------------------------------------------ */

  if (error && !examMeta) {
    return (
      <Alert severity="error">
        <AlertTitle>Could not open the exam</AlertTitle>
        {error}
      </Alert>
    );
  }
  if (!examMeta) return <CircularProgress />;

  /* ------------------------------------------------------------------ */
  /*   Render – submitted view                                           */
  /* ------------------------------------------------------------------ */

  if (examMeta.taken) {
    return (
      <Stack spacing={3}>
        <Typography variant="h4">{examMeta.title}</Typography>
        <Card variant="outlined">
          <CardContent>
            <Stack spacing={2}>
              <Typography variant="h6">Answers submitted</Typography>
              <Alert severity="success">
                Your answers and the proctoring report were sent to UnivAI. Your
                grade will appear on your dashboard once it is recorded.
              </Alert>
              <Stack direction="row" spacing={2}>
                <Button variant="contained" href={`${returnUrl}/exams`}>
                  Back to UnivAI
                </Button>
                <Button variant="outlined" href={`${returnUrl}/dashboard`}>
                  See your dashboard
                </Button>
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      </Stack>
    );
  }

  /* ------------------------------------------------------------------ */
  /*   Render – taking view                                              */
  /* ------------------------------------------------------------------ */

  const answeredCount = Object.values(answers).filter((a) => a.trim()).length;

  return (
    <Stack spacing={3}>
      <Typography variant="h4">{examMeta.title}</Typography>

      <Alert severity="warning">
        You are being proctored: leaving this tab, copy/paste, and exiting
        fullscreen are recorded
        {warnings
          ? ` (${warnings} event${warnings === 1 ? "" : "s"} so far)`
          : ""}
        .
      </Alert>

      <LinearProgress
        variant="determinate"
        value={(answeredCount / Math.max(1, totalQuestions)) * 100}
      />
      <Typography variant="body2" color="text.secondary">
        {answeredCount} of {totalQuestions} answered
      </Typography>

      <Box sx={{ display: "flex", gap: 2 }}>
        {/* ---- Left sidebar ---- */}
        <Paper
          variant="outlined"
          sx={{
            width: 180,
            flexShrink: 0,
            p: 1,
            maxHeight: 500,
            overflow: "auto",
          }}
        >
          <Stack spacing={0.5}>
            {Array.from({ length: totalQuestions }, (_, i) => {
              const isFetched = !!fetchedQuestions[i];
              const isCurrent = i === currentIndex;
              const qId = `q_${i + 1}`;
              const isAnswered = !!(
                fetchedQuestions[i] && answers[qId]?.trim()
              );

              return (
                <Button
                  key={i}
                  size="small"
                  fullWidth
                  variant={isCurrent ? "contained" : "outlined"}
                  disabled={!isFetched}
                  onClick={() => goToQuestion(i)}
                  sx={{
                    justifyContent: "flex-start",
                    minWidth: 0,
                    textTransform: "none",
                    ...(isCurrent
                      ? {}
                      : isAnswered
                        ? { borderColor: "success.main", color: "success.main" }
                        : {}),
                  }}
                >
                  {i + 1}
                  {isAnswered && !isCurrent ? " ✓" : ""}
                </Button>
              );
            })}
          </Stack>
        </Paper>

        {/* ---- Main content ---- */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {currentQ ? (
            <Card variant="outlined">
              <CardContent>
                <Stack spacing={2}>
                  <Typography variant="subtitle1">
                    {currentIndex + 1}. {currentQ.prompt}
                  </Typography>

                  {currentQ.type === "mcq" ? (
                    <FormControl>
                      <FormLabel>Choose one</FormLabel>
                      <RadioGroup
                        value={answers[currentQ.question_id] ?? ""}
                        onChange={(e) =>
                          setAnswers((prev) => ({
                            ...prev,
                            [currentQ.question_id]: e.target.value,
                          }))
                        }
                      >
                        {(currentQ.options ?? []).map((opt) => (
                          <FormControlLabel
                            key={opt}
                            value={opt.slice(0, 1)}
                            control={<Radio />}
                            label={opt}
                          />
                        ))}
                      </RadioGroup>
                    </FormControl>
                  ) : (
                    <TextField
                      multiline
                      minRows={4}
                      fullWidth
                      label="Your answer"
                      value={answers[currentQ.question_id] ?? ""}
                      onChange={(e) =>
                        setAnswers((prev) => ({
                          ...prev,
                          [currentQ.question_id]: e.target.value,
                        }))
                      }
                    />
                  )}
                </Stack>
              </CardContent>
            </Card>
          ) : fetchingQ ? (
            <CircularProgress />
          ) : error ? (
            <Alert severity="error">{error}</Alert>
          ) : null}

          <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
            <Button
              variant="outlined"
              disabled={currentIndex === 0 || fetchingQ}
              onClick={goPrev}
            >
              Previous
            </Button>
            <Button
              variant="contained"
              disabled={isLastQuestion || fetchingQ}
              onClick={goNext}
            >
              {fetchingQ ? "Loading\u2026" : "Next"}
            </Button>
          </Stack>
        </Box>
      </Box>

      {error ? <Alert severity="error">{error}</Alert> : null}

      <Button
        variant="contained"
        size="large"
        disabled={submitting}
        onClick={() => setConfirmOpen(true)}
      >
        Submit exam
      </Button>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>Submit your answers?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            You answered {answeredCount} of {totalQuestions} questions. You
            cannot change your answers after submitting.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Keep working</Button>
          <Button variant="contained" onClick={submit} disabled={submitting}>
            {submitting ? "Submitting\u2026" : "Submit"}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

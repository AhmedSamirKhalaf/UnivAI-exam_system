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
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

/**
 * The exam-taking screen. Pure MUI: no CSS files.
 *
 * Flow:
 *   1. Load exam metadata
 *   2. Show proctoring consent dialog (screen recording permission + violations warning)
 *   3. Student must accept — exam does not start otherwise
 *   4. Screen recording starts via getDisplayMedia()
 *   5. Screen-change detection runs during the exam
 *   6. On violation: screenshot is captured and sent to the webhook
 *
 * Questions are fetched one-by-one and cached on the client.
 * A left sidebar shows all question numbers; only fetched ones are clickable.
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

type ViolationEntry = {
  kind: string;
  detail: string;
  timestamp: string;
};

type Props = { examId: string; returnUrl: string };

const VIOLATIONS_GUIDE: { kind: string; label: string }[] = [
  {
    kind: "multi_display",
    label: "Having more than one display connected to your device",
  },
  {
    kind: "screen_change",
    label: "Changing your screen configuration during the exam",
  },
  {
    kind: "window_move",
    label: "Moving the exam window between screens",
  },
];

/* ------------------------------------------------------------------ */
/*   Helpers                                                           */
/* ------------------------------------------------------------------ */

async function captureScreenshot(
  stream: MediaStream
): Promise<string | null> {
  try {
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    await video.play();

    const track = stream.getVideoTracks()[0];
    const { width = 1280, height = 720 } = track.getSettings();
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0, width, height);
    video.srcObject = null;
    track.stop();

    return new Promise<string | null>((resolve) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(null);
            return;
          }
          const reader = new FileReader();
          reader.onloadend = () => {
            const result = reader.result;
            resolve(typeof result === "string" ? result : null);
          };
          reader.readAsDataURL(blob);
        },
        "image/jpeg",
        0.6
      );
    });
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*   Component                                                         */
/* ------------------------------------------------------------------ */

export default function ExamRunner({ examId, returnUrl }: Props) {
  const [examMeta, setExamMeta] = useState<ExamMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [warnings, setWarnings] = useState(0);

  const [fetchedQuestions, setFetchedQuestions] = useState<
    Record<number, Question>
  >({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [fetchingQ, setFetchingQ] = useState(false);

  // Consent & screen recording
  const [consentGiven, setConsentGiven] = useState(false);
  const [consentDenied, setConsentDenied] = useState(false);
  const [denialWarningOpen, setDenialWarningOpen] = useState(false);
  const [screenViolations, setScreenViolations] = useState<ViolationEntry[]>(
    []
  );

  const examMetaRef = useRef<ExamMeta | null>(null);
  const fetchedRef = useRef<Record<number, Question>>({});
  const fetchingSet = useRef<Set<number>>(new Set());
  const screenStreamRef = useRef<MediaStream | null>(null);

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
      setError(
        err instanceof Error ? err.message : "Could not load the exam."
      );
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
        if (!res.ok)
          throw new Error(data.error ?? "Failed to fetch question.");

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

  // Load exam metadata on mount, then kick off the first question fetch
  // ONLY after consent is given — no questions should reach the client before then.
  useEffect(() => {
    loadExamMeta();
  }, [loadExamMeta]);

  useEffect(() => {
    if (
      consentGiven &&
      examMeta &&
      examMeta.question_count > 0 &&
      !fetchedRef.current[0]
    ) {
      fetchQuestion(0);
    }
  }, [consentGiven, examMeta, fetchQuestion]);

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
  /*   Proctoring — report helper                                        */
  /* ------------------------------------------------------------------ */

  const report = useCallback(
    (
      type:
        | "tab_switch"
        | "copy_paste"
        | "fullscreen_exit"
        | "devtools_open"
        | "screen_violation",
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

  /** Take a screenshot and POST it to the webhook endpoint. */
  const sendScreenshot = useCallback(
    async (violationKind: string, detail: string) => {
      const meta = examMetaRef.current;
      const stream = screenStreamRef.current;
      if (!meta || !stream) return;

      const entry: ViolationEntry = {
        kind: violationKind,
        detail,
        timestamp: new Date().toISOString(),
      };
      setScreenViolations((prev) => [...prev, entry]);

      report("screen_violation", entry);

      const image = await captureScreenshot(stream);
      if (!image) return;

      fetch(`/api/exams/${examId}/screenshot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          student_id: meta.student_id,
          image,
          violation_type: violationKind,
          metadata: entry,
        }),
      }).catch(() => undefined);
    },
    [examId, report]
  );

  /* ------------------------------------------------------------------ */
  /*   Proctoring — tab / copy / fullscreen                              */
  /* ------------------------------------------------------------------ */

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
  /*   Proctoring — DevTools detection & input blocking                  */
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    let devtoolsReported = false;

    const reportOnce = () => {
      if (!devtoolsReported) {
        devtoolsReported = true;
        report("devtools_open");
      }
    };

    const onContextMenu = (e: MouseEvent) => e.preventDefault();

    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toUpperCase();
      if (e.key === "F12") {
        e.preventDefault();
        return;
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        ["I", "J", "C", "K"].includes(key)
      ) {
        e.preventDefault();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && key === "U") {
        e.preventDefault();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && key === "S") {
        e.preventDefault();
        return;
      }
    };

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
      if (deltaW > DIM_THRESHOLD || deltaH > DIM_THRESHOLD) {
        reportOnce();
      }
    };

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
  /*   Screen-change detection (runs after consent)                      */
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    if (!consentGiven || !examMeta || examMeta.taken) return;

    let lastScreenCount = 1;
    let lastLeft = window.screenLeft;
    let lastTop = window.screenTop;
    let screenDetailsAvailable = false;

    // --- 1. Quick check via screen.isExtended ---
    const checkIsExtended = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = window.screen as any;
      if (typeof s.isExtended === "boolean" && s.isExtended) {
        return 2; // at least 2 displays
      }
      return 1;
    };
    lastScreenCount = checkIsExtended();

    // --- 2. Try getScreenDetails for full info ---
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    if (typeof w.getScreenDetails === "function") {
      w.getScreenDetails()
        .then((details: { screens: Array<unknown> }) => {
          screenDetailsAvailable = true;
          const count = details.screens?.length ?? 1;
          if (count > lastScreenCount) {
            sendScreenshot(
              "multi_display",
              `${count} displays detected via getScreenDetails`
            );
            lastScreenCount = count;
          }

          // Listen for screen configuration changes
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (details as any).addEventListener?.("change", () => {
            const newCount = details.screens?.length ?? 1;
            if (newCount !== lastScreenCount) {
              sendScreenshot(
                "screen_change",
                `Display count changed from ${lastScreenCount} to ${newCount}`
              );
              lastScreenCount = newCount;
            }
          });
        })
        .catch(() => {
          // Permission denied or API unavailable — fall back to basic checks
        });
    }

    // --- 3. Track window position changes (screenLeft / screenTop) ---
    const POS_THRESHOLD = 50;
    const onWindowMove = () => {
      const left = window.screenLeft;
      const top = window.screenTop;
      const deltaLeft = Math.abs(left - lastLeft);
      const deltaTop = Math.abs(top - lastTop);
      lastLeft = left;
      lastTop = top;

      if (deltaLeft > POS_THRESHOLD || deltaTop > POS_THRESHOLD) {
        sendScreenshot(
          "window_move",
          `Window moved: screenLeft=${left} screenTop=${top} (delta ${deltaLeft}x${deltaTop})`
        );
      }
    };

    // --- 4. Periodic isExtended re-check (fallback when getScreenDetails unavailable) ---
    const pollInterval = setInterval(() => {
      if (screenDetailsAvailable) return; // getScreenDetails handles it
      const currentCount = checkIsExtended();
      if (currentCount !== lastScreenCount) {
        sendScreenshot(
          "multi_display",
          `Display count changed from ${lastScreenCount} to ${currentCount} (poll)`
        );
        lastScreenCount = currentCount;
      }
    }, 5000);

    window.addEventListener("resize", onWindowMove);

    return () => {
      window.removeEventListener("resize", onWindowMove);
      clearInterval(pollInterval);
    };
  }, [consentGiven, examMeta, sendScreenshot]);

  /* ------------------------------------------------------------------ */
  /*   Consent — start screen recording                                  */
  /* ------------------------------------------------------------------ */

  async function handleConsent() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "monitor" },
        audio: false,
      });
      screenStreamRef.current = stream;

      // Stop tracks if the browser's native "Stop sharing" button is clicked
      stream.getVideoTracks()[0].addEventListener("ended", () => {
        screenStreamRef.current = null;
        sendScreenshot(
          "screen_change",
          "Screen sharing was stopped by the user"
        );
      });

      setConsentGiven(true);
    } catch {
      setDenialWarningOpen(true);
    }
  }

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

  const goToQuestion = useCallback((index: number) => {
    if (fetchedRef.current[index]) setCurrentIndex(index);
  }, []);

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

      // Stop screen recording on submit
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;

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
  /*   Render — loading / error                                          */
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
  /*   Render — submitted view                                           */
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
                Your answers and the proctoring report were sent to UnivAI.
                Your grade will appear on your dashboard once it is recorded.
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
  /*   Render — consent denied (exam cannot start)                       */
  /* ------------------------------------------------------------------ */

  if (consentDenied) {
    return (
      <Stack spacing={3}>
        <Typography variant="h4">{examMeta.title}</Typography>
        <Card variant="outlined">
          <CardContent>
            <Stack spacing={2}>
              <Typography variant="h6">Exam cannot be started</Typography>
              <Alert severity="error">
                Screen recording permission is required to ensure exam
                fairness. Without it, the exam cannot proceed. Please contact
                your instructor if you believe this is an error.
              </Alert>
              <Button variant="contained" href={`${returnUrl}/exams`}>
                Back to UnivAI
              </Button>
            </Stack>
          </CardContent>
        </Card>
      </Stack>
    );
  }

  /* ------------------------------------------------------------------ */
  /*   Render — consent dialog (blocks exam until accepted)              */
  /* ------------------------------------------------------------------ */

  if (!consentGiven) {
    return (
      <Stack spacing={3}>
        <Typography variant="h4">{examMeta.title}</Typography>

        <Card variant="outlined">
          <CardContent>
            <Stack spacing={2}>
              <Typography variant="h6">Exam Proctoring Notice</Typography>

              <DialogContentText>
                This exam session requires screen recording for proctoring
                purposes. Your screen will be recorded for the duration of the
                exam. The following activities are monitored and will be
                logged as violations:
              </DialogContentText>

              <List dense>
                {VIOLATIONS_GUIDE.map((v) => (
                  <ListItem key={v.kind}>
                    <ListItemText primary={v.label} />
                  </ListItem>
                ))}
              </List>

              <Alert severity="warning">
                Any violation will be logged and may result in your exam being
                invalidated. A screenshot will be captured at the time of each
                violation.
              </Alert>

              {error ? <Alert severity="error">{error}</Alert> : null}

              <Button variant="contained" onClick={handleConsent}>
                I understand and consent — start exam
              </Button>
            </Stack>
          </CardContent>
        </Card>

        {/* Denial warning — shown when getDisplayMedia is rejected */}
        <Dialog
          open={denialWarningOpen}
          onClose={() => {}}
        >
          <DialogTitle>Screen sharing is required</DialogTitle>
          <DialogContent>
            <DialogContentText>
              You cannot access this exam unless you allow screen recording.
              Screen sharing is required to guarantee fairness during the exam.
              If you do not grant permission, the exam cannot proceed.
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button
              onClick={() => {
                setDenialWarningOpen(false);
                setConsentDenied(true);
              }}
            >
              End exam
            </Button>
            <Button
              variant="contained"
              onClick={() => {
                setDenialWarningOpen(false);
                handleConsent();
              }}
            >
              Try again
            </Button>
          </DialogActions>
        </Dialog>
      </Stack>
    );
  }

  /* ------------------------------------------------------------------ */
  /*   Render — taking view                                              */
  /* ------------------------------------------------------------------ */

  const answeredCount = Object.values(answers).filter((a) => a.trim()).length;

  return (
    <Stack spacing={3}>
      <Typography variant="h4">{examMeta.title}</Typography>

      <Alert severity="warning">
        You are being proctored: leaving this tab, copy/paste, exiting
        fullscreen, opening DevTools, and screen changes are recorded
        {warnings
          ? ` (${warnings} event${warnings === 1 ? "" : "s"} so far)`
          : ""}
        .
        {screenViolations.length > 0
          ? ` — ${screenViolations.length} screen violation${screenViolations.length === 1 ? "" : "s"} logged`
          : ""}
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
                  }}
                >
                  {i + 1}
                  {isAnswered && !isCurrent ? " \u2713" : ""}
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

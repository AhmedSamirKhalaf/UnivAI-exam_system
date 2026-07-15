"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormLabel from "@mui/material/FormLabel";
import Grid from "@mui/material/Grid";
import LinearProgress from "@mui/material/LinearProgress";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

/**
 * The exam-taking screen. Pure MUI: no CSS files, no sx, no styled().
 *
 * Proctoring: leaving the tab, exiting fullscreen, and copy/paste are reported
 * to the proctoring API while the exam is open. The suspicion score they feed
 * lives on the exam session and comes back to the UnivAI app with the result.
 */

type Question = {
  question_id: string;
  prompt: string;
  type: "mcq" | "essay";
  options?: string[];
};

type Exam = {
  _id: string;
  type: "quiz" | "mid" | "final";
  title: string;
  student_id: string;
  taken: boolean;
  mark?: number;
  passing_mark?: number;
  passed: boolean;
  integrity_status: "clean" | "invalidated";
  generated_questions?: Question[];
};

type Props = { examId: string };

export default function ExamRunner({ examId }: Props) {
  const [exam, setExam] = useState<Exam | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [warnings, setWarnings] = useState(0);
  const examRef = useRef<Exam | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/exams/${examId}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load the exam.");
      setExam(data);
      examRef.current = data;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the exam.");
    }
  }, [examId]);

  useEffect(() => {
    load();
  }, [load]);

  /** Report a proctoring event. Never throws: proctoring must not break the exam. */
  const report = useCallback(
    (type: "tab_switch" | "copy_paste" | "fullscreen_exit", metadata?: object) => {
      const current = examRef.current;
      if (!current || current.taken) return;
      setWarnings((count) => count + 1);
      fetch(`/api/exams/${examId}/proctoring-event`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, student_id: current.student_id, metadata }),
      }).catch(() => undefined);
    },
    [examId]
  );

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) report("tab_switch");
    };
    const onCopyPaste = (event: ClipboardEvent) => report("copy_paste", { kind: event.type });
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

  async function submit() {
    if (!exam) return;
    setSubmitting(true);
    setError(null);
    try {
      const student_answers = (exam.generated_questions ?? []).map((question) => ({
        question_id: question.question_id,
        answer: answers[question.question_id] ?? "",
      }));
      const res = await fetch(`/api/exams/${examId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ student_answers }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Submission failed.");
      setExam(data);
      examRef.current = data;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed.");
    } finally {
      setSubmitting(false);
      setConfirmOpen(false);
    }
  }

  if (error && !exam) {
    return (
      <Alert severity="error">
        <AlertTitle>Could not open the exam</AlertTitle>
        {error}
      </Alert>
    );
  }
  if (!exam) return <CircularProgress />;

  // ---------------------------------------------------------------- result view
  if (exam.taken) {
    const total = exam.generated_questions?.length ?? 0;
    return (
      <Stack spacing={3}>
        <Typography variant="h4">{exam.title}</Typography>
        <Card variant="outlined">
          <CardContent>
            <Stack spacing={2}>
              <Typography variant="h6">Your result</Typography>
              <Grid container spacing={1}>
                <Grid>
                  <Chip
                    color={exam.passed ? "success" : "error"}
                    label={exam.passed ? "PASSED" : "NOT PASSED"}
                  />
                </Grid>
                <Grid>
                  <Chip
                    variant="outlined"
                    label={`score: ${exam.mark ?? "—"} / ${total || "?"}`}
                  />
                </Grid>
                {exam.passing_mark !== undefined ? (
                  <Grid>
                    <Chip variant="outlined" label={`pass mark: ${exam.passing_mark}`} />
                  </Grid>
                ) : null}
                {exam.integrity_status === "invalidated" ? (
                  <Grid>
                    <Chip color="error" label="integrity: invalidated" />
                  </Grid>
                ) : null}
              </Grid>
              <Alert severity={exam.passed ? "success" : "info"}>
                Your result has been sent back to UnivAI — you can close this tab and
                check your dashboard.
              </Alert>
            </Stack>
          </CardContent>
        </Card>
      </Stack>
    );
  }

  // ---------------------------------------------------------------- taking view
  const questions = exam.generated_questions ?? [];
  const answered = questions.filter((q) => (answers[q.question_id] ?? "").trim()).length;

  return (
    <Stack spacing={3}>
      <Typography variant="h4">{exam.title}</Typography>

      <Alert severity="warning">
        You are being proctored: leaving this tab, copy/paste, and exiting fullscreen
        are recorded{warnings ? ` (${warnings} event${warnings === 1 ? "" : "s"} so far)` : ""}.
      </Alert>

      <LinearProgress variant="determinate" value={(answered / Math.max(1, questions.length)) * 100} />
      <Typography variant="body2" color="text.secondary">
        {answered} of {questions.length} answered
      </Typography>

      {questions.map((question, index) => (
        <Card key={question.question_id} variant="outlined">
          <CardContent>
            <Stack spacing={2}>
              <Typography variant="subtitle1">
                {index + 1}. {question.prompt}
              </Typography>

              {question.type === "mcq" ? (
                <FormControl>
                  <FormLabel>Choose one</FormLabel>
                  <RadioGroup
                    value={answers[question.question_id] ?? ""}
                    onChange={(event) =>
                      setAnswers((previous) => ({
                        ...previous,
                        [question.question_id]: event.target.value,
                      }))
                    }
                  >
                    {(question.options ?? []).map((option) => (
                      <FormControlLabel
                        key={option}
                        // Their grader compares against the leading letter ("A".."D").
                        value={option.slice(0, 1)}
                        control={<Radio />}
                        label={option}
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
                  value={answers[question.question_id] ?? ""}
                  onChange={(event) =>
                    setAnswers((previous) => ({
                      ...previous,
                      [question.question_id]: event.target.value,
                    }))
                  }
                />
              )}
            </Stack>
          </CardContent>
        </Card>
      ))}

      {error ? <Alert severity="error">{error}</Alert> : null}

      <Grid container spacing={2}>
        <Grid>
          <Button
            variant="contained"
            size="large"
            disabled={submitting}
            onClick={() => setConfirmOpen(true)}
          >
            Submit exam
          </Button>
        </Grid>
      </Grid>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>Submit your answers?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            You answered {answered} of {questions.length} questions. You cannot change
            your answers after submitting.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Keep working</Button>
          <Button variant="contained" onClick={submit} disabled={submitting}>
            {submitting ? "Submitting…" : "Submit"}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

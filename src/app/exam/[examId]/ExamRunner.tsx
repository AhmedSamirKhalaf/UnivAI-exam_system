"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
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
import Grid from "@mui/material/Grid";
import LinearProgress from "@mui/material/LinearProgress";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useExamIntegrityChannel } from "@/lib/use-exam-integrity-channel";
import { ExamListenerRegistry } from "@/lib/exam-listener-registry";
import { useExamDeterrents } from "@/lib/use-exam-deterrents";

type Question = {
  question_id: string;
  prompt: string;
  type: "mcq" | "essay";
  options?: string[];
};

type ExamAttempt = {
  _id: string;
  type: "quiz" | "mid" | "final";
  title: string;
  taken: boolean;
  integrity_status: "clean" | "invalidated";
  current_question: Question | null;
  progress: { position: number; total: number; answered: number };
  answer_revision: number;
  can_submit: boolean;
  integrity_state: "active" | "reconnecting" | "grace" | "integrity_locked" | "submitted";
  lock_reason?: string;
};

type Props = { examId: string; returnUrl: string; devToken?: string };

export default function ExamRunner({ examId, returnUrl, devToken }: Props) {
  const [exam, setExam] = useState<ExamAttempt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [warnings, setWarnings] = useState(0);
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const accessTokenRef = useRef<string | null>(null);
  const listenerRegistryRef = useRef<ExamListenerRegistry | null>(null);

  const requestHeaders = useCallback(
    (json = false, token = accessTokenRef.current): HeadersInit => ({
      ...(json ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(devToken ? { "x-univai-dev-token": devToken } : {}),
    }),
    [devToken],
  );

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 15000);
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const token = fragment.get("attempt_token");
    if (token) {
      accessTokenRef.current = token;
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    }

    fetch(`/api/exams/${examId}`, {
      cache: "no-store",
      headers: requestHeaders(false, token),
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not load the exam.");
        if (active) {
          setExam(data);
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setError(err instanceof DOMException && err.name === "AbortError"
            ? "The exam request timed out. Check the server connection and refresh."
            : err instanceof Error ? err.message : "Could not load the exam.");
        }
      });

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [examId, requestHeaders]);

  const { status: channelStatus, lockReason, sendEvent } = useExamIntegrityChannel({
    examId,
    enabled: Boolean(exam && !exam.taken),
    accessTokenRef,
    listenerRegistryRef,
    devToken,
  });

  const onBlockedAction = useCallback((message: string) => {
    setWarnings((count) => count + 1);
    setBlockedMessage(message);
  }, []);

  useExamDeterrents({
    enabled: Boolean(exam && !exam.taken && channelStatus !== "locked"),
    registryRef: listenerRegistryRef,
    sendEvent,
    onBlockedAction,
  });

  async function saveAndContinue(action: "answer" | "skip") {
    const current = exam?.current_question;
    if (!exam || !current) return;
    setSaving(true);
    setError(null);
    setSavedMessage(null);
    try {
      const response = await fetch(`/api/exams/${examId}/answer`, {
        method: "POST",
        headers: requestHeaders(true),
        body: JSON.stringify({
          question_id: current.question_id,
          answer,
          action,
          revision: exam.answer_revision,
          idempotency_key: crypto.randomUUID(),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not save the answer.");
      setExam(data);
      setAnswer("");
      setSavedMessage(action === "skip" ? "Question skipped and saved." : "Answer saved.");
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not save the answer.");
    } finally {
      setSaving(false);
    }
  }

  async function submit() {
    if (!exam?.can_submit) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/exams/${examId}/submit`, {
        method: "POST",
        headers: requestHeaders(),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Submission failed.");
      setExam(data);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Submission failed.");
    } finally {
      setSubmitting(false);
      setConfirmOpen(false);
    }
  }

  if (error && !exam) {
    return <Alert severity="error"><AlertTitle>Could not open the exam</AlertTitle>{error}</Alert>;
  }
  if (!exam) return <CircularProgress />;

  if (exam.taken) {
    return (
      <Stack spacing={3}>
        <Typography variant="h4">{exam.title}</Typography>
        <Alert severity="success">Your answers were submitted and sent to UnivAI for grading and review.</Alert>
        <Grid container spacing={2}>
          <Grid><Button variant="contained" href={`${returnUrl}/exams`}>Back to UnivAI</Button></Grid>
          <Grid><Button variant="outlined" href={`${returnUrl}/dashboard`}>See your dashboard</Button></Grid>
        </Grid>
      </Stack>
    );
  }

  const question = exam.current_question;
  const progressValue = (exam.progress.answered / Math.max(1, exam.progress.total)) * 100;

  return (
    <Stack spacing={3}>
      <Typography variant="h4">{exam.title}</Typography>
      <Alert severity="warning">
        Exam activity is monitored. Integrity channel: {channelStatus}. Common copy, tab, fullscreen, and developer-tool actions are recorded
        {warnings ? ` (${warnings} notice${warnings === 1 ? "" : "s"})` : ""}.
      </Alert>
      {blockedMessage ? <Alert severity="warning" role="alert">{blockedMessage}</Alert> : null}
      <LinearProgress variant="determinate" value={progressValue} />
      <Typography variant="body2" color="text.secondary">
        {exam.progress.answered} of {exam.progress.total} completed
      </Typography>
      {savedMessage ? <Alert severity="success" role="status">{savedMessage}</Alert> : null}

      {channelStatus === "locked" || exam.integrity_state === "integrity_locked" ? (
        <Alert severity="error" role="alert">
          <AlertTitle>Exam paused for integrity review</AlertTitle>
          {lockReason ?? exam.lock_reason ?? "The server locked this attempt. Your accepted answers were preserved."}
        </Alert>
      ) : channelStatus === "grace" ? (
        <Alert severity="warning" role="status">
          The integrity connection is in its grace period. Question changes are paused while we reconnect.
        </Alert>
      ) : question ? (
        <Card variant="outlined">
          <CardContent>
            <Stack spacing={2}>
              <Typography variant="overline">Question {exam.progress.position} of {exam.progress.total}</Typography>
              <Typography variant="h6">{question.prompt}</Typography>
              {question.type === "mcq" ? (
                <FormControl>
                  <FormLabel>Choose one</FormLabel>
                  <RadioGroup value={answer} onChange={(event) => setAnswer(event.target.value)}>
                    {(question.options ?? []).map((option) => (
                      <FormControlLabel key={option} value={option.slice(0, 1)} control={<Radio />} label={option} />
                    ))}
                  </RadioGroup>
                </FormControl>
              ) : (
                <TextField multiline minRows={4} fullWidth label="Your answer" value={answer} onChange={(event) => setAnswer(event.target.value)} />
              )}
              <Grid container spacing={2}>
                <Grid><Button variant="outlined" disabled={saving} onClick={() => void saveAndContinue("skip")}>Skip</Button></Grid>
                <Grid><Button variant="contained" disabled={saving || !answer.trim()} onClick={() => void saveAndContinue("answer")}>{saving ? "Saving…" : "Save and continue"}</Button></Grid>
              </Grid>
            </Stack>
          </CardContent>
        </Card>
      ) : (
        <Card variant="outlined">
          <CardContent>
            <Stack spacing={2}>
              <Typography variant="h6">All questions completed</Typography>
              <Typography color="text.secondary">Your {exam.progress.total} answers and skips are stored on the server.</Typography>
              <Button variant="contained" size="large" disabled={!exam.can_submit || submitting} onClick={() => setConfirmOpen(true)}>Submit exam</Button>
            </Stack>
          </CardContent>
        </Card>
      )}

      {error ? <Alert severity="error" role="alert">{error}</Alert> : null}
      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>Submit your answers?</DialogTitle>
        <DialogContent><DialogContentText>You completed all {exam.progress.total} questions. You cannot change them after submitting.</DialogContentText></DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Keep working</Button>
          <Button variant="contained" onClick={() => void submit()} disabled={submitting}>{submitting ? "Submitting…" : "Submit"}</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

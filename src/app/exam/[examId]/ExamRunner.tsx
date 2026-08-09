"use client";

import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Collapse from "@mui/material/Collapse";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import Fade from "@mui/material/Fade";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormLabel from "@mui/material/FormLabel";
import LinearProgress from "@mui/material/LinearProgress";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Stack from "@mui/material/Stack";
import Step from "@mui/material/Step";
import StepLabel from "@mui/material/StepLabel";
import Stepper from "@mui/material/Stepper";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import ArrowForwardRounded from "@mui/icons-material/ArrowForwardRounded";
import CheckCircleOutlineRounded from "@mui/icons-material/CheckCircleOutlineRounded";
import CloudDoneOutlined from "@mui/icons-material/CloudDoneOutlined";
import CloudSyncOutlined from "@mui/icons-material/CloudSyncOutlined";
import FullscreenRounded from "@mui/icons-material/FullscreenRounded";
import GavelRounded from "@mui/icons-material/GavelRounded";
import LockOutlined from "@mui/icons-material/LockOutlined";
import QuizOutlined from "@mui/icons-material/QuizOutlined";
import ScheduleOutlined from "@mui/icons-material/ScheduleOutlined";
import SecurityRounded from "@mui/icons-material/SecurityRounded";
import SendRounded from "@mui/icons-material/SendRounded";
import SkipNextRounded from "@mui/icons-material/SkipNextRounded";
import TaskAltRounded from "@mui/icons-material/TaskAltRounded";
import { useExamIntegrityChannel, type IntegrityChannelStatus } from "@/lib/use-exam-integrity-channel";
import { ExamListenerRegistry } from "@/lib/exam-listener-registry";
import { useExamDeterrents } from "@/lib/use-exam-deterrents";

type Question = {
  question_id: string;
  prompt: string;
  type: "mcq" | "essay";
  options?: string[];
};

type AttemptPolicy = {
  assessment_type: "quiz" | "mid" | "final" | "unknown";
  max_attempts: number;
  attempts_used: number;
  attempts_remaining: number;
  cooldown_seconds: number;
  next_attempt_at: string | null;
  can_start: boolean;
  reason_code:
    | "ok"
    | "attempt_active"
    | "cooldown"
    | "exhausted"
    | "unknown_assessment_type";
};

type ExamAttempt = {
  _id: string;
  type: "quiz" | "mid" | "final";
  title: string;
  taken: boolean;
  integrity_status: "clean" | "invalidated";
  started_at?: string;
  current_question: Question | null;
  progress: { position: number; total: number; answered: number };
  answer_revision: number;
  can_submit: boolean;
  integrity_state: "active" | "reconnecting" | "grace" | "integrity_locked" | "submitted";
  lock_reason?: string;
  attempt_policy?: AttemptPolicy;
  attempt_statement?: string;
  result?: {
    grading_status: "auto_graded" | "pending_review" | "graded";
    mark?: number;
    passing_mark?: number;
    passed: boolean;
    integrity_status: "clean" | "invalidated";
    review_status: "not_required" | "pending" | "cleared" | "upheld";
  };
};

type Props = { examId: string; returnUrl: string; devToken?: string };
type StatusPresentation = {
  label: string;
  color: "default" | "primary" | "success" | "warning" | "error";
  icon: ReactElement;
};

function channelPresentation(status: IntegrityChannelStatus): StatusPresentation {
  if (status === "connected") {
    return { label: "Secure connection active", color: "success", icon: <CloudDoneOutlined /> };
  }
  if (status === "locked") {
    return { label: "Exam locked", color: "error", icon: <LockOutlined /> };
  }
  if (status === "reconnecting" || status === "grace") {
    return { label: status === "grace" ? "Connection grace period" : "Reconnecting", color: "warning", icon: <CloudSyncOutlined /> };
  }
  return { label: status === "connecting" ? "Connecting securely" : "Not connected", color: "primary", icon: <CloudSyncOutlined /> };
}

function formatElapsed(startedAt?: string, now = Date.now()): string {
  if (!startedAt) return "Timer unavailable";
  if (now === 0) return "Session active";
  const total = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1_000));
  const hours = Math.floor(total / 3_600).toString().padStart(2, "0");
  const minutes = Math.floor((total % 3_600) / 60).toString().padStart(2, "0");
  const seconds = (total % 60).toString().padStart(2, "0");
  return `Elapsed ${hours}:${minutes}:${seconds}`;
}

function useElapsedLabel(startedAt: string | undefined, active: boolean): string {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active]);
  return formatElapsed(startedAt, now);
}

function localEligibleTime(nextAttemptAt: string): string {
  const date = new Date(nextAttemptAt);
  return Number.isNaN(date.getTime())
    ? "unavailable"
    : date.toLocaleString();
}

function PolicyNotice({
  policy,
  statement,
}: {
  policy: AttemptPolicy;
  statement: string;
}) {
  return (
    <Alert severity="info" icon={<ScheduleOutlined />} role="status">
      <AlertTitle>Attempt policy</AlertTitle>
      <Typography variant="body2">{statement}</Typography>
      <Typography variant="body2">
        Used {policy.attempts_used} of {policy.max_attempts} attempts ·{" "}
        {policy.attempts_remaining} remaining
      </Typography>
      {policy.reason_code === "cooldown" && policy.next_attempt_at ? (
        <Typography variant="body2">
          Next attempt eligible at {localEligibleTime(policy.next_attempt_at)}
        </Typography>
      ) : null}
      {policy.reason_code === "exhausted" ? (
        <Typography variant="body2">
          No attempts remain for this assessment.
        </Typography>
      ) : null}
    </Alert>
  );
}

function PolicyBlockedCard({ exam }: { exam: ExamAttempt }) {
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={3}>
          <LockOutlined color="error" fontSize="large" />
          <Typography variant="h4">This attempt is not available yet</Typography>
          {exam.attempt_statement && exam.attempt_policy ? (
            <PolicyNotice
              policy={exam.attempt_policy}
              statement={exam.attempt_statement}
            />
          ) : null}
          <Typography color="text.secondary">
            Return to UnivAI to start this exam when it becomes eligible.
          </Typography>
        </Stack>
      </CardContent>
    </Card>
  );
}

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
  const [rulesAccepted, setRulesAccepted] = useState(false);
  const [readinessStep, setReadinessStep] = useState(0);
  const [readinessMessage, setReadinessMessage] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [fullscreenPaused, setFullscreenPaused] = useState(false);
  const [devToolsPaused, setDevToolsPaused] = useState(false);
  const accessTokenRef = useRef<string | null>(null);
  const listenerRegistryRef = useRef<ExamListenerRegistry | null>(null);
  const restoreRequestedRef = useRef(false);
  const fullscreenPausedRef = useRef(false);
  const devToolsPausedRef = useRef(false);

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
        if (active) setExam(data);
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

  const locked = exam?.integrity_state === "integrity_locked";
  const { status: channelStatus, lockReason, sendEvent } = useExamIntegrityChannel({
    examId,
    enabled: Boolean(started && exam && !exam.taken && !locked),
    accessTokenRef,
    listenerRegistryRef,
    devToken,
  });

  useEffect(() => {
    if (channelStatus !== "connected") {
      restoreRequestedRef.current = false;
      return;
    }
    if (
      !started ||
      !exam ||
      exam.current_question ||
      exam.progress.answered >= exam.progress.total ||
      restoreRequestedRef.current
    ) return;
    restoreRequestedRef.current = true;
    let active = true;
    fetch(`/api/exams/${examId}`, {
      cache: "no-store",
      headers: requestHeaders(),
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not restore the current question.");
        if (active) setExam(data);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : "Could not restore the current question.");
      });
    return () => {
      active = false;
    };
  }, [channelStatus, exam, examId, requestHeaders, started]);

  const onBlockedAction = useCallback((message: string) => {
    setWarnings((count) => count + 1);
    setBlockedMessage(message);
  }, []);

  const onFullscreenChange = useCallback((active: boolean) => {
    if (active) {
      fullscreenPausedRef.current = false;
      setFullscreenPaused(false);
      setReadinessMessage(null);
      setBlockedMessage(null);
      return;
    }
    if (!fullscreenPausedRef.current) {
      onBlockedAction("Fullscreen is required. The exam is paused until you return to fullscreen.");
    }
    fullscreenPausedRef.current = true;
    setFullscreenPaused(true);
    setConfirmOpen(false);
  }, [onBlockedAction]);

  const onDevToolsChange = useCallback((suspected: boolean) => {
    if (!suspected) {
      devToolsPausedRef.current = false;
      setDevToolsPaused(false);
      return;
    }
    if (!devToolsPausedRef.current) {
      onBlockedAction("Developer tools or a large browser panel were detected. Close them to continue.");
    }
    devToolsPausedRef.current = true;
    setDevToolsPaused(true);
    setConfirmOpen(false);
  }, [onBlockedAction]);

  useExamDeterrents({
    enabled: Boolean(exam && !exam.taken && channelStatus !== "locked"),
    registryRef: listenerRegistryRef,
    sendEvent,
    onBlockedAction,
    onFullscreenChange,
    onDevToolsChange,
  });

  async function beginExam() {
    setReadinessMessage(null);
    try {
      if (devToolsPausedRef.current) {
        setReadinessMessage("Close developer tools or large browser panels before starting the exam.");
        return;
      }
      if (!document.fullscreenEnabled || !document.documentElement.requestFullscreen) {
        setReadinessMessage("Fullscreen is required to take this exam. Use a browser that supports fullscreen.");
        return;
      }
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      if (!document.fullscreenElement) throw new Error("Fullscreen did not activate.");
      fullscreenPausedRef.current = false;
      setFullscreenPaused(false);
      setReadinessStep(2);
      setStarted(true);
    } catch {
      setReadinessMessage("Fullscreen could not start. Allow fullscreen, then try again.");
    }
  }

  async function returnToFullscreen() {
    setReadinessMessage(null);
    try {
      if (!document.fullscreenEnabled || !document.documentElement.requestFullscreen) {
        throw new Error("Fullscreen is unavailable.");
      }
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      if (!document.fullscreenElement) throw new Error("Fullscreen did not activate.");
      fullscreenPausedRef.current = false;
      setFullscreenPaused(false);
      setBlockedMessage(null);
    } catch {
      setReadinessMessage("The exam remains paused. Allow fullscreen, then try again.");
    }
  }

  async function saveAndContinue(action: "answer" | "skip") {
    const current = exam?.current_question;
    if (
      !exam ||
      !current ||
      channelStatus !== "connected" ||
      fullscreenPausedRef.current ||
      devToolsPausedRef.current ||
      !document.fullscreenElement
    ) {
      if (started && !document.fullscreenElement) onFullscreenChange(false);
      return;
    }
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
      setSavedMessage(action === "skip" ? "Question skipped and saved on the server." : "Answer saved on the server.");
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not save the answer.");
    } finally {
      setSaving(false);
    }
  }

  async function submit() {
    if (
      !exam?.can_submit ||
      channelStatus !== "connected" ||
      fullscreenPausedRef.current ||
      devToolsPausedRef.current ||
      !document.fullscreenElement
    ) {
      if (started && !document.fullscreenElement) onFullscreenChange(false);
      return;
    }
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

  const elapsedLabel = useElapsedLabel(exam?.started_at, Boolean(started && exam && !exam.taken));

  if (error && !exam) {
    return (
      <Alert severity="error" role="alert">
        <AlertTitle>Could not open the exam</AlertTitle>
        {error}
      </Alert>
    );
  }
  if (!exam) {
    return (
      <Stack spacing={2}>
        <CircularProgress aria-label="Loading exam" />
        <Typography color="text.secondary" role="status">Preparing your exam…</Typography>
      </Stack>
    );
  }

  if (exam.taken) {
    const result = exam.result;
    const pending = result?.grading_status === "pending_review";
    const invalidated = result?.integrity_status === "invalidated";
    return (
      <Fade in timeout={225}>
        <Stack spacing={3}>
          <Card variant="outlined">
            <CardContent>
              <Stack spacing={3}>
                <TaskAltRounded color={invalidated ? "error" : pending ? "info" : "success"} fontSize="large" />
                <Stack spacing={1}>
                  <Typography variant="overline">Submission received</Typography>
                  <Typography variant="h4">{exam.title}</Typography>
                  <Typography color="text.secondary">
                    Your accepted answers are stored on the server. You can safely leave this page.
                  </Typography>
                </Stack>
                {invalidated ? (
                  <Alert severity="error" role="alert">
                    <AlertTitle>Result held for integrity review</AlertTitle>
                    This is a review state, not an automatic claim. Open UnivAI to see the recorded result and request support or an appeal.
                  </Alert>
                ) : pending ? (
                  <Alert severity="info" role="status">
                    <AlertTitle>Manual grading in progress</AlertTitle>
                    Your final result will appear in UnivAI after review.
                  </Alert>
                ) : result ? (
                  <Alert severity={result.passed ? "success" : "info"} role="status">
                    <AlertTitle>{result.passed ? "Passed" : "Grading complete"}</AlertTitle>
                    {result.mark !== undefined
                      ? `Score: ${result.mark}${result.passing_mark !== undefined ? ` · Passing mark: ${result.passing_mark}` : ""}`
                      : "Your result is ready in UnivAI."}
                  </Alert>
                ) : (
                  <Alert severity="success" role="status">Submission completed.</Alert>
                )}
                {exam.attempt_policy && exam.attempt_statement ? (
                  <PolicyNotice
                    policy={exam.attempt_policy}
                    statement={exam.attempt_statement}
                  />
                ) : null}
                <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                  <Button variant="contained" href={`${returnUrl}/exams`} startIcon={<QuizOutlined />}>
                    Open results in UnivAI
                  </Button>
                  <Button variant="outlined" href={`${returnUrl}/dashboard`}>
                    Go to dashboard
                  </Button>
                  {invalidated ? (
                    <Button variant="outlined" color="error" href={`${returnUrl}/exams`} startIcon={<GavelRounded />}>
                      Request review or appeal
                    </Button>
                  ) : null}
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        </Stack>
      </Fade>
    );
  }

  const isLocked = locked || channelStatus === "locked";
  if (isLocked) {
    return (
      <Card variant="outlined">
        <CardContent>
          <Stack spacing={3}>
            <LockOutlined color="error" fontSize="large" />
            <Typography variant="h4">Exam paused for review</Typography>
            <Alert severity="error" role="alert">
              <AlertTitle>Your accepted answers are preserved</AlertTitle>
              {lockReason ?? exam.lock_reason ?? "The server paused this attempt after an integrity protocol failure."}
            </Alert>
            <Typography color="text.secondary">
              This screen reports what happened; it does not declare a cheating verdict. Return to UnivAI for the review, resume, or appeal path.
            </Typography>
            <Button variant="contained" href={`${returnUrl}/exams`} startIcon={<GavelRounded />}>
              Open review options in UnivAI
            </Button>
          </Stack>
        </CardContent>
      </Card>
    );
  }

  if (started && fullscreenPaused && !exam.taken) {
    return (
      <Card variant="outlined">
        <CardContent>
          <Stack spacing={3}>
            <LockOutlined color="error" fontSize="large" />
            <Typography variant="h4">Exam paused — fullscreen required</Typography>
            <Alert severity="error" role="alert">
              <AlertTitle>You left fullscreen</AlertTitle>
              Questions and answer controls are blocked. Return to fullscreen to continue this attempt.
            </Alert>
            {readinessMessage ? <Alert severity="warning" role="alert">{readinessMessage}</Alert> : null}
            <Typography color="text.secondary">
              Answers already accepted by the server are preserved. Closing this message or pressing Escape cannot resume the exam.
            </Typography>
            <Button variant="contained" size="large" startIcon={<FullscreenRounded />} onClick={() => void returnToFullscreen()}>
              Return to fullscreen
            </Button>
          </Stack>
        </CardContent>
      </Card>
    );
  }

  if (started && devToolsPaused && !exam.taken) {
    return (
      <Card variant="outlined">
        <CardContent>
          <Stack spacing={3}>
            <LockOutlined color="error" fontSize="large" />
            <Typography variant="h4">Exam paused — close developer tools</Typography>
            <Alert severity="error" role="alert">
              <AlertTitle>Developer tools or a large browser panel are open</AlertTitle>
              Questions and answer controls are blocked. Close the panel and restore the browser window to continue.
            </Alert>
            <Typography color="text.secondary">
              The check runs automatically. Your accepted answers and the secure heartbeat remain active while this screen is shown.
            </Typography>
          </Stack>
        </CardContent>
      </Card>
    );
  }

  if (
    !started &&
    exam.attempt_policy &&
    !exam.attempt_policy.can_start &&
    (exam.attempt_policy.reason_code === "cooldown" ||
      exam.attempt_policy.reason_code === "exhausted")
  ) {
    return <PolicyBlockedCard exam={exam} />;
  }

  if (!started) {
    return (
      <Fade in timeout={225}>
        <Card variant="outlined">
          <CardContent>
            <Stack spacing={4}>
              <Stack spacing={1}>
                <span>
                  <Chip label={`${exam.type.toUpperCase()} · ${exam.progress.total} questions`} color="primary" variant="outlined" />
                </span>
                <Typography variant="h4">{exam.title}</Typography>
                <Typography color="text.secondary">A short readiness check gives you one clear road into the exam.</Typography>
              </Stack>
              {exam.attempt_statement && exam.attempt_policy ? (
                <PolicyNotice
                  policy={exam.attempt_policy}
                  statement={exam.attempt_statement}
                />
              ) : null}
              <Stepper activeStep={readinessStep} alternativeLabel>
                {[
                  ["Rules", "Read the exam policy"],
                  ["Ready", "Check this browser"],
                  ["Exam", "Answer one question at a time"],
                ].map(([label, description]) => (
                  <Step key={label}>
                    <StepLabel optional={<Typography variant="caption">{description}</Typography>}>{label}</StepLabel>
                  </Step>
                ))}
              </Stepper>
              {readinessStep === 0 ? (
                <Stack spacing={3}>
                  <Alert severity="info" icon={<SecurityRounded />}>
                    <AlertTitle>Integrity and privacy</AlertTitle>
                    The exam records blocked copy, tab, fullscreen, and developer-tool actions plus connection health. It does not collect typed key contents, clipboard contents, or continuous pointer movement.
                  </Alert>
                  <List aria-label="Exam rules">
                    <ListItem disableGutters>
                      <ListItemIcon><CheckCircleOutlineRounded color="primary" /></ListItemIcon>
                      <ListItemText primary="Stay in this exam window" secondary="Leaving fullscreen immediately pauses and blocks the exam until fullscreen is restored." />
                    </ListItem>
                    <ListItem disableGutters>
                      <ListItemIcon><CheckCircleOutlineRounded color="primary" /></ListItemIcon>
                      <ListItemText primary="Answer the current question" secondary="The server sends the next question only after this answer or skip is accepted." />
                    </ListItem>
                    <ListItem disableGutters>
                      <ListItemIcon><CheckCircleOutlineRounded color="primary" /></ListItemIcon>
                      <ListItemText primary="Know the MCQ scoring" secondary="Correct: +1. Wrong: -1. Blank or skipped: 0. Your total can never fall below 0." />
                    </ListItem>
                    <ListItem disableGutters>
                      <ListItemIcon><CheckCircleOutlineRounded color="primary" /></ListItemIcon>
                      <ListItemText primary="Wait for saved confirmation" secondary="Move forward only after the answer is safely stored on the server." />
                    </ListItem>
                  </List>
                  <FormControlLabel
                    control={<Checkbox checked={rulesAccepted} onChange={(event) => setRulesAccepted(event.target.checked)} />}
                    label="I understand the rules and monitoring notice."
                  />
                  <Button
                    variant="contained"
                    size="large"
                    disabled={!rulesAccepted}
                    endIcon={<ArrowForwardRounded />}
                    onClick={() => setReadinessStep(1)}
                  >
                    Continue to readiness
                  </Button>
                </Stack>
              ) : (
                <Stack spacing={3}>
                  <Alert severity="info">
                    <AlertTitle>Ready this browser</AlertTitle>
                    Close unrelated tabs and apps, use a stable connection, and allow fullscreen. A secure integrity connection will open before the first question becomes usable.
                  </Alert>
                  {readinessMessage ? <Alert severity="warning" role="alert">{readinessMessage}</Alert> : null}
                  {devToolsPaused ? (
                    <Alert severity="error" role="alert">
                      <AlertTitle>Close developer tools first</AlertTitle>
                      Developer tools or a large browser panel were detected. The start button will unlock automatically after the panel closes.
                    </Alert>
                  ) : null}
                  <Stack direction={{ xs: "column-reverse", sm: "row" }} spacing={2}>
                    <Button variant="outlined" onClick={() => setReadinessStep(0)}>Back to rules</Button>
                    <Button variant="contained" size="large" startIcon={<FullscreenRounded />} disabled={devToolsPaused} onClick={() => void beginExam()}>
                      Enter fullscreen and start
                    </Button>
                  </Stack>
                </Stack>
              )}
            </Stack>
          </CardContent>
        </Card>
      </Fade>
    );
  }

  const question = exam.current_question;
  const progressValue = (exam.progress.answered / Math.max(1, exam.progress.total)) * 100;
  const connection = channelPresentation(channelStatus);
  const channelReady = channelStatus === "connected";
  const connectionInterrupted = channelStatus === "reconnecting" || channelStatus === "grace";
  const restoringQuestion = !question && exam.progress.answered < exam.progress.total;

  return (
    <Stack spacing={3}>
      <Card variant="outlined">
        <CardContent>
          <Stack spacing={3}>
            <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
              <Stack spacing={0.5}>
                <Typography variant="overline">{exam.type} in progress</Typography>
                <Typography variant="h5">{exam.title}</Typography>
              </Stack>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                <Chip icon={connection.icon} label={connection.label} color={connection.color} variant={connection.color === "success" ? "filled" : "outlined"} />
                <Chip icon={<ScheduleOutlined />} label={elapsedLabel} variant="outlined" aria-label={elapsedLabel} />
                <Chip icon={<QuizOutlined />} label={`Question ${Math.min(exam.progress.position, exam.progress.total)} of ${exam.progress.total}`} variant="outlined" />
              </Stack>
            </Stack>
            <Divider />
            <Stack spacing={1}>
              <LinearProgress variant="determinate" value={progressValue} aria-label="Exam completion" />
              <Typography variant="body2" color="text.secondary">
                {exam.progress.answered} of {exam.progress.total} answers or skips accepted by the server
              </Typography>
            </Stack>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
              <Chip icon={<SecurityRounded />} label="Integrity monitoring on" color="primary" variant="outlined" />
              {warnings ? <Chip label={`${warnings} blocked action${warnings === 1 ? "" : "s"}`} color="warning" variant="outlined" /> : null}
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <Collapse in={Boolean(readinessMessage)} timeout={180} unmountOnExit>
        <Alert severity="warning" role="status">{readinessMessage}</Alert>
      </Collapse>
      <Collapse in={!channelReady} timeout={200} unmountOnExit>
        <Alert severity={connectionInterrupted ? "warning" : "info"} role="status">
          <AlertTitle>{connectionInterrupted ? "Connection interrupted" : "Opening the secure connection"}</AlertTitle>
          {channelStatus === "grace"
            ? "The server is preserving accepted answers during the grace period. Question actions stay paused until reconnection."
            : connectionInterrupted
              ? "Your current input stays on screen. Wait for the connected confirmation before continuing."
              : "The current question will be enabled after the signed heartbeat is accepted."}
        </Alert>
      </Collapse>
      <Collapse in={Boolean(blockedMessage)} timeout={200} unmountOnExit>
        <Alert severity="warning" role="alert" onClose={() => setBlockedMessage(null)}>
          <AlertTitle>Action blocked and recorded</AlertTitle>
          {blockedMessage}
        </Alert>
      </Collapse>
      <Collapse in={Boolean(savedMessage)} timeout={180} unmountOnExit>
        <Alert severity="success" role="status" icon={<CloudDoneOutlined />}>
          {savedMessage}
        </Alert>
      </Collapse>

      {question ? (
        <Fade key={question.question_id} in timeout={{ enter: 225, exit: 195 }}>
          <Card variant="outlined">
            <CardContent>
              <Stack spacing={3}>
                <Stack spacing={1}>
                  <Typography variant="overline" color="primary">Current question</Typography>
                  <Typography variant="h5" component="h1">{question.prompt}</Typography>
                </Stack>
                <Divider />
                {question.type === "mcq" ? (
                  <FormControl>
                    <FormLabel>Choose one answer</FormLabel>
                    <RadioGroup value={answer} onChange={(event) => setAnswer(event.target.value)}>
                      {(question.options ?? []).map((option) => (
                        <FormControlLabel key={option} value={option.slice(0, 1)} control={<Radio />} label={option} disabled={!channelReady || saving} />
                      ))}
                    </RadioGroup>
                  </FormControl>
                ) : (
                  <TextField
                    multiline
                    minRows={6}
                    fullWidth
                    label="Your answer"
                    value={answer}
                    disabled={!channelReady || saving}
                    onChange={(event) => setAnswer(event.target.value)}
                    helperText="Your answer moves forward only after the server confirms it was saved."
                  />
                )}
                <Stack direction={{ xs: "column-reverse", sm: "row" }} spacing={2}>
                  <Button variant="outlined" disabled={!channelReady || saving} startIcon={<SkipNextRounded />} onClick={() => void saveAndContinue("skip")}>
                    Skip and save
                  </Button>
                  <Button variant="contained" size="large" disabled={!channelReady || saving || !answer.trim()} endIcon={saving ? <CircularProgress size={18} color="inherit" /> : <ArrowForwardRounded />} onClick={() => void saveAndContinue("answer")}>
                    {saving ? "Saving…" : "Save and continue"}
                  </Button>
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        </Fade>
      ) : restoringQuestion ? (
        <Fade in timeout={225}>
          <Card variant="outlined">
            <CardContent>
              <Stack spacing={2}>
                <CircularProgress aria-label="Restoring current question" />
                <Typography variant="h6">Restoring the current question</Typography>
                <Typography color="text.secondary" role="status">
                  The secure connection is active. Waiting for the server-owned question state.
                </Typography>
              </Stack>
            </CardContent>
          </Card>
        </Fade>
      ) : (
        <Fade in timeout={225}>
          <Card variant="outlined">
            <CardContent>
              <Stack spacing={3}>
                <TaskAltRounded color="success" fontSize="large" />
                <Stack spacing={1}>
                  <Typography variant="h5">Every question is complete</Typography>
                  <Typography color="text.secondary">
                    The server accepted {exam.progress.total} answers or explicit skips. Review the finality notice before submitting.
                  </Typography>
                </Stack>
                <Button variant="contained" size="large" startIcon={<SendRounded />} disabled={!exam.can_submit || !channelReady || submitting} onClick={() => setConfirmOpen(true)}>
                  Review and submit
                </Button>
              </Stack>
            </CardContent>
          </Card>
        </Fade>
      )}

      <Collapse in={Boolean(error)} timeout={180} unmountOnExit>
        <Alert severity="error" role="alert" onClose={() => setError(null)}>
          <AlertTitle>Action not completed</AlertTitle>
          {error}
        </Alert>
      </Collapse>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} aria-labelledby="submit-dialog-title" aria-describedby="submit-dialog-description">
        <DialogTitle id="submit-dialog-title">Submit this exam?</DialogTitle>
        <DialogContent>
          <DialogContentText id="submit-dialog-description">
            The server accepted all {exam.progress.total} questions. Submission is final, and you cannot change an answer afterward.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)} disabled={submitting}>Keep working</Button>
          <Button variant="contained" startIcon={<SendRounded />} onClick={() => void submit()} disabled={submitting || !channelReady}>
            {submitting ? "Submitting…" : "Submit exam"}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

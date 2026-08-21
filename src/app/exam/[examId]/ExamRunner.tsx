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
import ArrowBackRounded from "@mui/icons-material/ArrowBackRounded";
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
import { useExamLocale } from "@/i18n/ExamLocaleProvider";
import {
  formatExamDateTime,
  localizePolicyStatement,
  localizeServerMessage,
  translateExam,
  type ExamLocale,
} from "@/i18n/exam-locale";

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
  type: "quiz" | "mid" | "final" | "practice";
  title: string;
  taken: boolean;
  integrity_status: "clean" | "invalidated";
  started_at?: string;
  deadline_at?: string;
  time_limit_seconds?: number;
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
    raw_mark?: number;
    mark?: number;
    passing_mark?: number;
    passed: boolean;
    integrity_status: "clean" | "invalidated";
    review_status: "not_required" | "pending" | "cleared" | "upheld";
    flagged: boolean;
    integrity_penalty_applied: boolean;
  };
};

type Props = { examId: string; returnUrl: string; devToken?: string };
type StatusPresentation = {
  label: string;
  color: "default" | "primary" | "success" | "warning" | "error";
  icon: ReactElement;
};

const EXAM_LOAD_TIMEOUTS_MS = [15_000, 45_000] as const;

function channelPresentation(
  status: IntegrityChannelStatus,
  locale: ExamLocale,
): StatusPresentation {
  if (status === "connected") {
    return { label: translateExam(locale, "secureConnectionActive"), color: "success", icon: <CloudDoneOutlined /> };
  }
  if (status === "locked") {
    return { label: translateExam(locale, "examLocked"), color: "error", icon: <LockOutlined /> };
  }
  if (status === "reconnecting" || status === "grace") {
    return {
      label: translateExam(locale, status === "grace" ? "connectionGracePeriod" : "reconnecting"),
      color: "warning",
      icon: <CloudSyncOutlined />,
    };
  }
  return {
    label: translateExam(locale, status === "connecting" ? "connectingSecurely" : "notConnected"),
    color: "primary",
    icon: <CloudSyncOutlined />,
  };
}

function clockTime(totalSeconds: number): string {
  const total = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(total / 3_600).toString().padStart(2, "0");
  const minutes = Math.floor((total % 3_600) / 60).toString().padStart(2, "0");
  const seconds = (total % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function formatSessionClock(
  startedAt: string | undefined,
  deadlineAt: string | undefined,
  locale: ExamLocale,
  now = Date.now(),
): string {
  if (deadlineAt) {
    if (now === 0) return translateExam(locale, "sessionActive");
    const remaining = Math.max(0, Math.ceil((new Date(deadlineAt).getTime() - now) / 1_000));
    return translateExam(locale, "timeRemaining", { time: clockTime(remaining) });
  }
  if (!startedAt) return translateExam(locale, "timerUnavailable");
  if (now === 0) return translateExam(locale, "sessionActive");
  const total = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1_000));
  return translateExam(locale, "elapsed", { time: clockTime(total) });
}

function useSessionClock(
  startedAt: string | undefined,
  deadlineAt: string | undefined,
  active: boolean,
  locale: ExamLocale,
): { label: string; remainingSeconds: number | null } {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active]);
  const remainingSeconds = deadlineAt && now > 0
    ? Math.max(0, Math.ceil((new Date(deadlineAt).getTime() - now) / 1_000))
    : null;
  return {
    label: formatSessionClock(startedAt, deadlineAt, locale, now),
    remainingSeconds,
  };
}

function localEligibleTime(nextAttemptAt: string, locale: ExamLocale): string {
  const date = new Date(nextAttemptAt);
  return Number.isNaN(date.getTime())
    ? translateExam(locale, "unavailable")
    : formatExamDateTime(locale, date);
}

function PolicyNotice({
  policy,
  statement,
}: {
  policy: AttemptPolicy;
  statement: string;
}) {
  const { locale, t } = useExamLocale();
  const policyStatement = localizePolicyStatement(
    locale,
    policy.assessment_type,
    statement,
  );

  return (
    <Alert severity="info" icon={<ScheduleOutlined />} role="status">
      <AlertTitle>{t("attemptPolicy")}</AlertTitle>
      <Typography variant="body2">{policyStatement}</Typography>
      <Typography variant="body2">
        {t("attemptUsage", {
          used: policy.attempts_used,
          maximum: policy.max_attempts,
        })}{" · "}
        {t("attemptsRemaining", { remaining: policy.attempts_remaining })}
      </Typography>
      {policy.reason_code === "cooldown" && policy.next_attempt_at ? (
        <Typography variant="body2">
          {t("nextAttemptEligible", {
            time: localEligibleTime(policy.next_attempt_at, locale),
          })}
        </Typography>
      ) : null}
      {policy.reason_code === "exhausted" ? (
        <Typography variant="body2">
          {t("noAttemptsRemain")}
        </Typography>
      ) : null}
    </Alert>
  );
}

function PolicyBlockedCard({ exam }: { exam: ExamAttempt }) {
  const { t } = useExamLocale();
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={3}>
          <LockOutlined color="error" fontSize="large" />
          <Typography variant="h4" component="h1">{t("attemptNotAvailable")}</Typography>
          {exam.attempt_statement && exam.attempt_policy ? (
            <PolicyNotice
              policy={exam.attempt_policy}
              statement={exam.attempt_statement}
            />
          ) : null}
          <Typography color="text.secondary">
            {t("returnWhenEligible")}
          </Typography>
        </Stack>
      </CardContent>
    </Card>
  );
}

export default function ExamRunner({ examId, returnUrl, devToken }: Props) {
  const { direction, locale, t } = useExamLocale();
  const ContinueIcon = direction === "rtl" ? ArrowBackRounded : ArrowForwardRounded;
  const [exam, setExam] = useState<ExamAttempt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
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
  const timeoutSubmissionRef = useRef(false);

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
    let controller: AbortController | null = null;
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const fragmentToken = fragment.get("attempt_token");
    if (fragmentToken) {
      accessTokenRef.current = fragmentToken;
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    }
    const attemptToken = fragmentToken ?? accessTokenRef.current;

    const loadExam = async () => {
      for (let attempt = 0; attempt < EXAM_LOAD_TIMEOUTS_MS.length; attempt += 1) {
        controller = new AbortController();
        const timeoutId = window.setTimeout(
          () => controller?.abort(),
          EXAM_LOAD_TIMEOUTS_MS[attempt],
        );
        try {
          const response = await fetch(`/api/exams/${examId}`, {
            cache: "no-store",
            headers: requestHeaders(false, attemptToken),
            signal: controller.signal,
          });
          const data = await response.json();
          if (!response.ok) {
            throw new Error(localizeServerMessage(locale, data.error, "loadExamFallback"));
          }
          if (active) setExam(data);
          return;
        } catch (caught: unknown) {
          const timedOut = caught instanceof DOMException && caught.name === "AbortError";
          if (timedOut && active && attempt + 1 < EXAM_LOAD_TIMEOUTS_MS.length) continue;
          if (active) {
            setError(timedOut
              ? t("loadExamTimeout")
              : localizeServerMessage(
                  locale,
                  caught instanceof Error ? caught.message : caught,
                  "loadExamFallback",
                ));
          }
          return;
        } finally {
          window.clearTimeout(timeoutId);
        }
      }
    };
    void loadExam();

    return () => {
      active = false;
      controller?.abort();
    };
  }, [examId, locale, requestHeaders, t]);

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
        if (!response.ok) {
          throw new Error(localizeServerMessage(locale, data.error, "restoreQuestionFallback"));
        }
        if (active) setExam(data);
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(localizeServerMessage(
            locale,
            caught instanceof Error ? caught.message : caught,
            "restoreQuestionFallback",
          ));
        }
      });
    return () => {
      active = false;
    };
  }, [channelStatus, exam, examId, locale, requestHeaders, started, t]);

  // Integrity evidence is recorded silently. Learners see no event count,
  // accusation, or per-action warning while the attempt is running.
  const onBlockedAction = useCallback((message: string) => {
    void message;
  }, []);

  const onFullscreenChange = useCallback((active: boolean) => {
    if (active) {
      fullscreenPausedRef.current = false;
      setFullscreenPaused(false);
      setReadinessMessage(null);
      return;
    }
    fullscreenPausedRef.current = true;
    setFullscreenPaused(true);
    setConfirmOpen(false);
  }, []);

  const onDevToolsChange = useCallback((suspected: boolean) => {
    if (!suspected) {
      devToolsPausedRef.current = false;
      setDevToolsPaused(false);
    }
    // Detection is evidence only. It is deliberately not announced in the
    // running exam; repeated signals are handled by the server-side flag rule.
  }, []);

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
        setReadinessMessage(t("closeDeveloperToolsBeforeStart"));
        return;
      }
      if (!document.fullscreenEnabled || !document.documentElement.requestFullscreen) {
        setReadinessMessage(t("fullscreenBrowserRequired"));
        return;
      }
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      if (!document.fullscreenElement) throw new Error("Fullscreen did not activate.");
      const response = await fetch(`/api/exams/${examId}/begin`, {
        method: "POST",
        headers: requestHeaders(),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(localizeServerMessage(locale, data.error, "examStartFailed"));
      }
      fullscreenPausedRef.current = false;
      setFullscreenPaused(false);
      setReadinessStep(2);
      setExam(data);
      setStarted(true);
    } catch (caught: unknown) {
      setReadinessMessage(localizeServerMessage(
        locale,
        caught instanceof Error ? caught.message : caught,
        "fullscreenCouldNotStart",
      ));
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
    } catch {
      setReadinessMessage(t("examRemainsPaused"));
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
      if (!response.ok) {
        throw new Error(localizeServerMessage(locale, data.error, "saveAnswerFallback"));
      }
      setExam(data);
      setAnswer("");
      setSavedMessage(action === "skip" ? t("questionSkippedSaved") : t("answerSaved"));
    } catch (caught: unknown) {
      setError(localizeServerMessage(
        locale,
        caught instanceof Error ? caught.message : caught,
        "saveAnswerFallback",
      ));
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
      if (!response.ok) {
        throw new Error(localizeServerMessage(locale, data.error, "submissionFailed"));
      }
      setExam(data);
    } catch (caught: unknown) {
      setError(localizeServerMessage(
        locale,
        caught instanceof Error ? caught.message : caught,
        "submissionFailed",
      ));
    } finally {
      setSubmitting(false);
      setConfirmOpen(false);
    }
  }

  const sessionClock = useSessionClock(
    exam?.started_at,
    exam?.deadline_at,
    Boolean(exam && !exam.taken && (started || exam.deadline_at)),
    locale,
  );

  useEffect(() => {
    if (
      !exam?.deadline_at ||
      exam.taken ||
      sessionClock.remainingSeconds !== 0 ||
      timeoutSubmissionRef.current
    ) return;

    timeoutSubmissionRef.current = true;
    const controller = new AbortController();
    setSubmitting(true);
    setConfirmOpen(false);
    setError(null);
    void fetch(`/api/exams/${examId}/submit`, {
      method: "POST",
      headers: requestHeaders(),
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) {
          throw new Error(localizeServerMessage(locale, data.error, "timeExpiredSubmissionFailed"));
        }
        setExam(data);
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        timeoutSubmissionRef.current = false;
        setError(localizeServerMessage(
          locale,
          caught instanceof Error ? caught.message : caught,
          "timeExpiredSubmissionFailed",
        ));
      })
      .finally(() => setSubmitting(false));

    return () => controller.abort();
  }, [
    exam?.deadline_at,
    exam?.taken,
    examId,
    locale,
    requestHeaders,
    sessionClock.remainingSeconds,
  ]);

  if (error && !exam) {
    return (
      <Alert severity="error" role="alert">
        <AlertTitle>{t("couldNotOpenExam")}</AlertTitle>
        {error}
      </Alert>
    );
  }
  if (!exam) {
    return (
      <Stack spacing={2}>
        <CircularProgress aria-label={t("loadingExam")} />
        <Typography color="text.secondary" role="status">{t("preparingExam")}</Typography>
      </Stack>
    );
  }

  if (exam.taken) {
    const result = exam.result;
    const pending = result?.grading_status === "pending_review";
    const invalidated = result?.integrity_status === "invalidated";
    const adjusted = result?.integrity_penalty_applied === true;
    return (
      <Fade in timeout={225}>
        <Stack spacing={3}>
          <Card variant="outlined">
            <CardContent>
              <Stack spacing={3}>
                <TaskAltRounded color={invalidated ? "error" : adjusted ? "warning" : pending ? "info" : "success"} fontSize="large" />
                <Stack spacing={1}>
                  <Typography variant="overline">{t("submissionReceived")}</Typography>
                  <Typography
                    variant="h4"
                    component="h1" dir="auto"
                    className="exam-generated-content"
                  >
                    {exam.title}
                  </Typography>
                  <Typography color="text.secondary">
                    {t("answersStored")}
                  </Typography>
                </Stack>
                {invalidated ? (
                  <Alert severity="error" role="alert">
                    <AlertTitle>{t("resultHeldForReview")}</AlertTitle>
                    {t("reviewStateExplanation")}
                  </Alert>
                ) : adjusted && result?.raw_mark !== undefined && result.mark !== undefined ? (
                  <Alert severity="warning" role="status">
                    <AlertTitle>{t("flaggedScoreAdjusted")}</AlertTitle>
                    {t("flaggedScoreExplanation", {
                      rawScore: result.raw_mark,
                      recordedScore: result.mark,
                    })}
                  </Alert>
                ) : pending ? (
                  <Alert severity="info" role="status">
                    <AlertTitle>{t("manualGrading")}</AlertTitle>
                    {t("resultAfterReview")}
                  </Alert>
                ) : result ? (
                  <Alert severity={result.passed ? "success" : "info"} role="status">
                    <AlertTitle>{result.passed ? t("passed") : t("gradingComplete")}</AlertTitle>
                    {result.mark !== undefined
                      ? result.passing_mark !== undefined
                        ? t("scoreAndPassingMark", {
                            score: result.mark,
                            passingMark: result.passing_mark,
                          })
                        : t("scoreOnly", { score: result.mark })
                      : t("resultReady")}
                  </Alert>
                ) : (
                  <Alert severity="success" role="status">{t("submissionCompleted")}</Alert>
                )}
                {exam.attempt_policy && exam.attempt_statement ? (
                  <PolicyNotice
                    policy={exam.attempt_policy}
                    statement={exam.attempt_statement}
                  />
                ) : null}
                <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                  <Button variant="contained" href={`${returnUrl}/exams`} startIcon={<QuizOutlined />}>
                    {t("openResults")}
                  </Button>
                  <Button variant="outlined" href={`${returnUrl}/dashboard`}>
                    {t("goToDashboard")}
                  </Button>
                  {invalidated ? (
                    <Button variant="outlined" color="error" href={`${returnUrl}/exams`} startIcon={<GavelRounded />}>
                      {t("requestReview")}
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
            <Typography variant="h4" component="h1">{t("examPausedForReview")}</Typography>
            <Alert severity="error" role="alert">
              <AlertTitle>{t("acceptedAnswersPreserved")}</AlertTitle>
              {localizeServerMessage(
                locale,
                lockReason ?? exam.lock_reason,
                "serverPausedAttempt",
              )}
            </Alert>
            <Typography color="text.secondary">
              {t("noCheatingVerdict")}
            </Typography>
            <Button variant="contained" href={`${returnUrl}/exams`} startIcon={<GavelRounded />}>
              {t("openReviewOptions")}
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
            <Typography variant="h4" component="h1">{t("examPausedFullscreen")}</Typography>
            <Alert severity="error" role="alert">
              <AlertTitle>{t("leftFullscreen")}</AlertTitle>
              {t("fullscreenControlsBlocked")}
            </Alert>
            {readinessMessage ? <Alert severity="warning" role="alert">{readinessMessage}</Alert> : null}
            <Typography color="text.secondary">
              {t("preservedWhilePaused")}
            </Typography>
            <Button variant="contained" size="large" startIcon={<FullscreenRounded />} onClick={() => void returnToFullscreen()}>
              {t("returnToFullscreen")}
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
            <Typography variant="h4" component="h1">{t("examPausedDeveloperTools")}</Typography>
            <Alert severity="error" role="alert">
              <AlertTitle>{t("developerToolsOpen")}</AlertTitle>
              {t("developerToolsControlsBlocked")}
            </Alert>
            <Typography color="text.secondary">
              {t("automaticDeveloperToolsCheck")}
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
                  <Chip
                    label={`${t(
                      exam.type === "quiz"
                        ? "quizLabel"
                        : exam.type === "mid"
                          ? "midtermLabel"
                          : exam.type === "practice"
                            ? "practiceLabel"
                            : "finalLabel",
                    )} · ${t("questionCount", { count: exam.progress.total })}`}
                    color="primary"
                    variant="outlined"
                  />
                </span>
                <Typography
                  variant="h4"
                  component="h1" dir="auto"
                  className="exam-generated-content"
                >
                  {exam.title}
                </Typography>
                <Typography color="text.secondary">{t("readinessIntroduction")}</Typography>
              </Stack>
              {exam.attempt_statement && exam.attempt_policy ? (
                <PolicyNotice
                  policy={exam.attempt_policy}
                  statement={exam.attempt_statement}
                />
              ) : null}
              <Stepper activeStep={readinessStep} alternativeLabel>
                {[
                  [t("stepRules"), t("stepRulesDescription")],
                  [t("stepReady"), t("stepReadyDescription")],
                  [t("stepExam"), t("stepExamDescription")],
                ].map(([label, description]) => (
                  <Step key={label}>
                    <StepLabel optional={<Typography variant="caption">{description}</Typography>}>{label}</StepLabel>
                  </Step>
                ))}
              </Stepper>
              {readinessStep === 0 ? (
                <Stack spacing={3}>
                  <Alert severity="info" icon={<SecurityRounded />}>
                    <AlertTitle>{t("integrityAndPrivacy")}</AlertTitle>
                    {t("monitoringNotice")}
                  </Alert>
                  <List aria-label={t("examRules")}>
                    <ListItem disableGutters>
                      <ListItemIcon><CheckCircleOutlineRounded color="primary" /></ListItemIcon>
                      <ListItemText primary={t("stayInExamWindow")} secondary={t("stayInExamWindowDetail")} />
                    </ListItem>
                    <ListItem disableGutters>
                      <ListItemIcon><CheckCircleOutlineRounded color="primary" /></ListItemIcon>
                      <ListItemText primary={t("answerCurrentQuestion")} secondary={t("answerCurrentQuestionDetail")} />
                    </ListItem>
                    <ListItem disableGutters>
                      <ListItemIcon><CheckCircleOutlineRounded color="primary" /></ListItemIcon>
                      <ListItemText primary={t("knowMcqScoring")} secondary={t("knowMcqScoringDetail")} />
                    </ListItem>
                    <ListItem disableGutters>
                      <ListItemIcon><CheckCircleOutlineRounded color="primary" /></ListItemIcon>
                      <ListItemText primary={t("waitForSaved")} secondary={t("waitForSavedDetail")} />
                    </ListItem>
                  </List>
                  <FormControlLabel
                    control={<Checkbox checked={rulesAccepted} onChange={(event) => setRulesAccepted(event.target.checked)} />}
                    label={t("acknowledgeRules")}
                  />
                  <Button
                    variant="contained"
                    size="large"
                    disabled={!rulesAccepted}
                    endIcon={<ContinueIcon />}
                    onClick={() => setReadinessStep(1)}
                  >
                    {t("continueToReadiness")}
                  </Button>
                </Stack>
              ) : (
                <Stack spacing={3}>
                  <Alert severity="info">
                    <AlertTitle>{t("readyThisBrowser")}</AlertTitle>
                    {t("readyBrowserDetail")}
                  </Alert>
                  {readinessMessage ? <Alert severity="warning" role="alert">{readinessMessage}</Alert> : null}
                  {devToolsPaused ? (
                    <Alert severity="error" role="alert">
                      <AlertTitle>{t("closeDeveloperToolsFirst")}</AlertTitle>
                      {t("closeDeveloperToolsDetail")}
                    </Alert>
                  ) : null}
                  <Stack direction={{ xs: "column-reverse", sm: "row" }} spacing={2}>
                    <Button variant="outlined" onClick={() => setReadinessStep(0)}>{t("backToRules")}</Button>
                    <Button variant="contained" size="large" startIcon={<FullscreenRounded />} disabled={devToolsPaused} onClick={() => void beginExam()}>
                      {t("enterFullscreenAndStart")}
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
  const connection = channelPresentation(channelStatus, locale);
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
                <Typography variant="overline">
                  {t("examInProgress", {
                    type: t(
                      exam.type === "quiz"
                        ? "quizLabel"
                        : exam.type === "mid"
                          ? "midtermLabel"
                          : exam.type === "practice"
                            ? "practiceLabel"
                            : "finalLabel",
                    ),
                  })}
                </Typography>
                <Typography
                  variant="h5"
                  component="h1" dir="auto"
                  className="exam-generated-content"
                >
                  {exam.title}
                </Typography>
              </Stack>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                <Chip icon={connection.icon} label={connection.label} color={connection.color} variant={connection.color === "success" ? "filled" : "outlined"} />
                <Chip
                  icon={<ScheduleOutlined />}
                  label={sessionClock.label}
                  color={sessionClock.remainingSeconds !== null && sessionClock.remainingSeconds <= 60 ? "warning" : "default"}
                  variant="outlined"
                  aria-label={sessionClock.label}
                />
                <Chip
                  icon={<QuizOutlined />}
                  label={t("questionPosition", {
                    position: Math.min(exam.progress.position, exam.progress.total),
                    total: exam.progress.total,
                  })}
                  variant="outlined"
                />
              </Stack>
            </Stack>
            <Divider />
            <Stack spacing={1}>
              <LinearProgress variant="determinate" value={progressValue} aria-label={t("examCompletion")} />
              <Typography variant="body2" color="text.secondary">
                {t("acceptedProgress", {
                  answered: exam.progress.answered,
                  total: exam.progress.total,
                })}
              </Typography>
            </Stack>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
              <Chip icon={<SecurityRounded />} label={t("integrityMonitoringOn")} color="primary" variant="outlined" />
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <Collapse in={Boolean(readinessMessage)} timeout={180} unmountOnExit>
        <Alert severity="warning" role="status">{readinessMessage}</Alert>
      </Collapse>
      <Collapse in={!channelReady} timeout={200} unmountOnExit>
        <Alert severity={connectionInterrupted ? "warning" : "info"} role="status">
          <AlertTitle>{connectionInterrupted ? t("connectionInterrupted") : t("openingSecureConnection")}</AlertTitle>
          {channelStatus === "grace"
            ? t("gracePeriodDetail")
            : connectionInterrupted
              ? t("reconnectingDetail")
              : t("connectingDetail")}
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
                  <Typography variant="overline" color="primary">{t("currentQuestion")}</Typography>
                  <Typography
                    variant="h5"
                    component="h2" dir="auto"
                    className="exam-generated-content"
                  >
                    {question.prompt}
                  </Typography>
                </Stack>
                <Divider />
                {question.type === "mcq" ? (
                  <FormControl>
                    <FormLabel>{t("chooseOneAnswer")}</FormLabel>
                    <RadioGroup value={answer} onChange={(event) => setAnswer(event.target.value)}>
                      {(question.options ?? []).map((option) => (
                        <FormControlLabel
                          key={option}
                          value={option}
                          control={<Radio />}
                          label={
                            <span dir="auto" className="exam-generated-content">
                              {option}
                            </span>
                          }
                          disabled={!channelReady || saving}
                        />
                      ))}
                    </RadioGroup>
                  </FormControl>
                ) : (
                  <TextField
                    multiline
                    minRows={6}
                    fullWidth
                    label={t("yourAnswer")}
                    value={answer}
                    disabled={!channelReady || saving}
                    onChange={(event) => setAnswer(event.target.value)}
                    helperText={t("answerSaveHelper")}
                    slotProps={{ htmlInput: { dir: "auto" } }}
                  />
                )}
                <Stack direction={{ xs: "column-reverse", sm: "row" }} spacing={2}>
                  <Button variant="outlined" disabled={!channelReady || saving} startIcon={<SkipNextRounded />} onClick={() => void saveAndContinue("skip")}>
                    {t("skipAndSave")}
                  </Button>
                  <Button variant="contained" size="large" disabled={!channelReady || saving || !answer.trim()} endIcon={saving ? <CircularProgress size={18} color="inherit" /> : <ContinueIcon />} onClick={() => void saveAndContinue("answer")}>
                    {saving ? t("saving") : t("saveAndContinue")}
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
                <CircularProgress aria-label={t("restoringQuestion")} />
                <Typography variant="h6">{t("restoringCurrentQuestion")}</Typography>
                <Typography color="text.secondary" role="status">
                  {t("restoringDetail")}
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
                  <Typography variant="h5">{t("everyQuestionComplete")}</Typography>
                  <Typography color="text.secondary">
                    {t("everyQuestionCompleteDetail", { total: exam.progress.total })}
                  </Typography>
                </Stack>
                <Button variant="contained" size="large" startIcon={<SendRounded />} disabled={!exam.can_submit || !channelReady || submitting} onClick={() => setConfirmOpen(true)}>
                  {t("reviewAndSubmit")}
                </Button>
              </Stack>
            </CardContent>
          </Card>
        </Fade>
      )}

      <Collapse in={Boolean(error)} timeout={180} unmountOnExit>
        <Alert severity="error" role="alert" closeText={t("close")} onClose={() => setError(null)}>
          <AlertTitle>{t("actionNotCompleted")}</AlertTitle>
          {error}
        </Alert>
      </Collapse>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} aria-labelledby="submit-dialog-title" aria-describedby="submit-dialog-description">
        <DialogTitle id="submit-dialog-title">{t("submitExamQuestion")}</DialogTitle>
        <DialogContent>
          <DialogContentText id="submit-dialog-description">
            {t("submissionFinality", { total: exam.progress.total })}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)} disabled={submitting}>{t("keepWorking")}</Button>
          <Button variant="contained" startIcon={<SendRounded />} onClick={() => void submit()} disabled={submitting || !channelReady}>
            {submitting ? t("submitting") : t("submitExam")}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

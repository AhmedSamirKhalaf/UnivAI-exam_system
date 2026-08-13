import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { notFound } from "next/navigation";

import { isStandalone, standaloneToken } from "@/lib/runtime";
import { translateExam, type ExamMessageKey } from "@/i18n/exam-locale";
import { getRequestExamLocale } from "@/i18n/request-locale";

const scenarios = [
  ["scenarioNotStarted", "64b000000000000000000021"],
  ["scenarioActiveAttempt", "64b000000000000000000022"],
  ["scenarioSubmittedResult", "64b000000000000000000023"],
  ["scenarioPendingManualGrading", "64b000000000000000000024"],
  ["scenarioFlaggedHumanReview", "64b000000000000000000025"],
] as const;

export const dynamic = "force-dynamic";

export default async function DevScenariosPage() {
  if (!isStandalone()) notFound();
  const token = standaloneToken();
  const locale = await getRequestExamLocale();
  const t = (key: ExamMessageKey) => translateExam(locale, key);
  return (
    <Stack spacing={3}>
      <Alert severity="warning">{t("standaloneDevelopmentData")}</Alert>
      <Typography variant="h4" component="h1">{t("examScenarios")}</Typography>
      <Typography color="text.secondary">
        {t("scenarioDescription")}
      </Typography>
      {scenarios.map(([labelKey, examId]) => (
        <Card variant="outlined" key={examId}>
          <CardContent>
            <Stack spacing={2}>
              <Typography variant="h6">{t(labelKey)}</Typography>
              <Typography variant="body2" lang="en" dir="ltr">{examId}</Typography>
              <Button
                variant="contained"
                href={`/exam/${examId}?dev_token=${token}`}
              >
                {t("openScenario")}
              </Button>
            </Stack>
          </CardContent>
        </Card>
      ))}
      <Button variant="outlined" href={`/api/dev/webhooks?dev_token=${token}`}>
        {t("viewCapturedWebhooks")}
      </Button>
    </Stack>
  );
}

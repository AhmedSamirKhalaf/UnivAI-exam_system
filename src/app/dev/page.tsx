import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { notFound } from "next/navigation";

import { isStandalone, standaloneToken } from "@/lib/runtime";

const scenarios = [
  ["Not started", "64b000000000000000000021"],
  ["Active attempt", "64b000000000000000000022"],
  ["Submitted result", "64b000000000000000000023"],
  ["Pending manual grading", "64b000000000000000000024"],
  ["Flagged for human review", "64b000000000000000000025"],
] as const;

export const dynamic = "force-dynamic";

export default function DevScenariosPage() {
  if (!isStandalone()) notFound();
  const token = standaloneToken();
  return (
    <Stack spacing={3}>
      <Alert severity="warning">Standalone development data</Alert>
      <Typography variant="h4">Exam scenarios</Typography>
      <Typography color="text.secondary">
        These fixed scenarios use synthetic identities and project-authored questions.
        A flagged session records observations and risk for review; it does not declare
        that a learner cheated.
      </Typography>
      {scenarios.map(([label, examId]) => (
        <Card variant="outlined" key={examId}>
          <CardContent>
            <Stack spacing={2}>
              <Typography variant="h6">{label}</Typography>
              <Typography variant="body2">{examId}</Typography>
              <Button
                variant="contained"
                href={`/exam/${examId}?dev_token=${token}`}
              >
                Open scenario
              </Button>
            </Stack>
          </CardContent>
        </Card>
      ))}
      <Button variant="outlined" href={`/api/dev/webhooks?dev_token=${token}`}>
        View captured result webhooks
      </Button>
    </Stack>
  );
}

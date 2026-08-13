import Alert from "@mui/material/Alert";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { translateExam } from "@/i18n/exam-locale";
import { getRequestExamLocale } from "@/i18n/request-locale";

export default async function Home() {
  const locale = await getRequestExamLocale();
  const t = (key: Parameters<typeof translateExam>[1]) => translateExam(locale, key);

  return (
    <Stack spacing={3}>
      <Typography variant="h4" component="h1">{t("homeTitle")}</Typography>
      <Typography variant="body1" color="text.secondary">
        {t("homeDescription")}
      </Typography>
      <Alert severity="info">
        {t("homeAccidental")}
      </Alert>
    </Stack>
  );
}

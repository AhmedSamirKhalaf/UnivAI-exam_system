import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { translateExam } from "@/i18n/exam-locale";
import { getRequestExamLocale } from "@/i18n/request-locale";

export default async function NotFound() {
  const locale = await getRequestExamLocale();
  const t = (key: Parameters<typeof translateExam>[1]) => translateExam(locale, key);

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={3}>
          <Typography variant="h4" component="h1">
            {t("pageNotFoundTitle")}
          </Typography>
          <Typography color="text.secondary">{t("pageNotFoundBody")}</Typography>
          <Button variant="contained" href="/">
            {t("returnHome")}
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}

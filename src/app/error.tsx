"use client";

import { useEffect } from "react";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import { useExamLocale } from "@/i18n/ExamLocaleProvider";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useExamLocale();

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Stack spacing={3}>
      <Alert severity="error" role="alert">
        <AlertTitle>{t("unexpectedErrorTitle")}</AlertTitle>
        {t("unexpectedErrorBody")}
      </Alert>
      <Button variant="contained" onClick={reset}>
        {t("tryAgain")}
      </Button>
    </Stack>
  );
}

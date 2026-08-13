import type { Metadata } from "next";
import CssBaseline from "@mui/material/CssBaseline";
import AppBar from "@mui/material/AppBar";
import Button from "@mui/material/Button";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import Container from "@mui/material/Container";
import Alert from "@mui/material/Alert";
import Stack from "@mui/material/Stack";
import SchoolRounded from "@mui/icons-material/SchoolRounded";
import ExamThemeProvider from "./ExamThemeProvider";
import { examDirection, translateExam } from "@/i18n/exam-locale";
import { getRequestExamLocale } from "@/i18n/request-locale";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestExamLocale();
  return {
    title: translateExam(locale, "metadataTitle"),
    description: translateExam(locale, "metadataDescription"),
  };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await getRequestExamLocale();
  const direction = examDirection(locale);
  const t = (key: Parameters<typeof translateExam>[1]) => translateExam(locale, key);

  return (
    <html lang={locale} dir={direction}>
      <body>
        <ExamThemeProvider locale={locale}>
          <CssBaseline />
          <Button
            component="a"
            href="#main-content"
            className="exam-skip-link"
            variant="contained"
          >
            {t("skipToMain")}
          </Button>
          <AppBar position="sticky" color="inherit">
            <Toolbar>
              <Stack direction="row" spacing={1.5}>
                <SchoolRounded color="primary" />
                <Typography variant="h6">{t("appName")}</Typography>
              </Stack>
            </Toolbar>
          </AppBar>
          <Container component="main" id="main-content" tabIndex={-1} maxWidth="lg">
            <Stack spacing={3}>
              <Toolbar variant="dense" />
              {process.env.UNIVAI_MODE === "standalone" &&
              process.env.NODE_ENV !== "production" ? (
                <Alert severity="warning">{t("standaloneDevelopmentData")}</Alert>
              ) : null}
              {children}
              <Toolbar />
            </Stack>
          </Container>
        </ExamThemeProvider>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v16-appRouter";
import CssBaseline from "@mui/material/CssBaseline";
import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import Container from "@mui/material/Container";
import Alert from "@mui/material/Alert";
import Stack from "@mui/material/Stack";
import SchoolRounded from "@mui/icons-material/SchoolRounded";
import ExamThemeProvider from "./ExamThemeProvider";

export const metadata: Metadata = {
  title: "UnivAI Exams",
  description: "Quizzes and exams for the UnivAI learning simulator",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AppRouterCacheProvider>
          <ExamThemeProvider>
            <CssBaseline />
            <AppBar position="sticky" color="inherit">
              <Toolbar>
                <Stack direction="row" spacing={1.5}>
                  <SchoolRounded color="primary" />
                  <Typography variant="h6">UnivAI Exams</Typography>
                </Stack>
              </Toolbar>
            </AppBar>
            <Container component="main" maxWidth="lg">
              <Stack spacing={3}>
                <Toolbar variant="dense" />
                {process.env.UNIVAI_MODE === "standalone" &&
                process.env.NODE_ENV !== "production" ? (
                  <Alert severity="warning">Standalone development data</Alert>
                ) : null}
                {children}
                <Toolbar />
              </Stack>
            </Container>
          </ExamThemeProvider>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}

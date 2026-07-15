import type { Metadata } from "next";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v16-appRouter";
import CssBaseline from "@mui/material/CssBaseline";
import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import Container from "@mui/material/Container";

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
          <CssBaseline />
          <AppBar position="static" color="secondary">
            <Toolbar>
              <Typography variant="h6">UnivAI Exams</Typography>
            </Toolbar>
          </AppBar>
          <Container maxWidth="md">
            {/* Toolbar as a pure-MUI vertical spacer: no CSS files in this app. */}
            <Toolbar variant="dense" />
            {children}
            <Toolbar />
          </Container>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}

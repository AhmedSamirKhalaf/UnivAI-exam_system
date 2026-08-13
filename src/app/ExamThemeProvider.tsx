"use client";

import { useMemo, type ReactNode } from "react";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v16-appRouter";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { prefixer } from "stylis";
import rtlPlugin from "stylis-plugin-rtl";
import { ExamLocaleProvider } from "@/i18n/ExamLocaleProvider";
import { examDirection, type ExamLocale } from "@/i18n/exam-locale";

function createExamTheme(locale: ExamLocale) {
  return createTheme({
    cssVariables: true,
    direction: examDirection(locale),
    palette: {
      mode: "light",
      background: { default: "#F6F8FC", paper: "#FFFFFF" },
      text: { primary: "#172033", secondary: "#44516A" },
      primary: { main: "#2847C7", contrastText: "#FFFFFF" },
      secondary: { main: "#44516A", contrastText: "#FFFFFF" },
      success: { main: "#075A31", light: "#EAF8F0", contrastText: "#FFFFFF" },
      warning: { main: "#6B3900", light: "#FFF4E5", contrastText: "#FFFFFF" },
      error: { main: "#8A1C13", light: "#FFF1F0", contrastText: "#FFFFFF" },
      info: { main: "#0E4691", light: "#EFF4FF", contrastText: "#FFFFFF" },
      divider: "#667085",
    },
    shape: { borderRadius: 16 },
    motion: { reducedMotion: "system" },
    transitions: {
      duration: {
        shortest: 150,
        shorter: 180,
        short: 200,
        standard: 225,
        complex: 250,
        enteringScreen: 225,
        leavingScreen: 195,
      },
    },
    typography: {
      fontFamily: 'Roboto, "Noto Sans Arabic", Arial, sans-serif',
      h4: { fontWeight: 750, letterSpacing: locale === "ar" ? 0 : "-0.025em" },
      h5: { fontWeight: 750, letterSpacing: locale === "ar" ? 0 : "-0.02em" },
      h6: { fontWeight: 700 },
      button: { fontWeight: 700 },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            backgroundColor: "#F6F8FC",
          },
          ".exam-skip-link.MuiButton-root": {
            position: "fixed",
            insetBlockStart: 8,
            insetInlineStart: 8,
            zIndex: 2000,
            transform: "translateY(-180%)",
            backgroundColor: "#FFFFFF",
            color: "#172033",
            border: "2px solid #172033",
          },
          ".exam-skip-link.MuiButton-root:focus-visible": {
            transform: "translateY(0)",
          },
          ".exam-generated-content": {
            unicodeBidi: "isolate",
          },
          "@media (prefers-reduced-motion: reduce)": {
            "*, *::before, *::after": {
              animationDuration: "0.01ms !important",
              animationIterationCount: "1 !important",
              scrollBehavior: "auto !important",
              transitionDuration: "0.01ms !important",
            },
          },
        },
      },
      MuiAppBar: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: {
            backgroundColor: "#FFFFFF",
            color: "#172033",
            borderBottom: "1px solid #667085",
          },
        },
      },
      MuiButtonBase: {
        styleOverrides: {
          root: {
            minHeight: 44,
            minWidth: 44,
            "&:focus-visible": {
              outline: "3px solid #512DA8",
              outlineOffset: 3,
            },
            "&.Mui-focusVisible": {
              outline: "3px solid #512DA8",
              outlineOffset: 3,
            },
          },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: {
            minHeight: 44,
            minWidth: 44,
            borderRadius: 10,
            textTransform: "none",
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            borderColor: "#667085",
            boxShadow: "0 12px 32px rgba(23, 32, 51, 0.08)",
          },
        },
      },
      MuiPaper: {
        styleOverrides: { root: { backgroundImage: "none" } },
      },
      MuiLinearProgress: {
        styleOverrides: { root: { height: 8, borderRadius: 999 } },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            "& .MuiOutlinedInput-notchedOutline": {
              borderColor: "#667085",
            },
            "&:has(input:focus-visible), &:has(textarea:focus-visible)": {
              outline: "3px solid #512DA8",
              outlineOffset: 3,
            },
          },
        },
      },
      MuiChip: {
        styleOverrides: { root: { fontWeight: 700 } },
      },
      MuiDialog: {
        styleOverrides: { paper: { border: "1px solid #667085" } },
      },
    },
  });
}

export default function ExamThemeProvider({
  children,
  locale,
}: {
  children: ReactNode;
  locale: ExamLocale;
}) {
  const direction = examDirection(locale);
  const examTheme = useMemo(() => createExamTheme(locale), [locale]);

  return (
    <AppRouterCacheProvider
      options={
        direction === "rtl"
          ? { key: "mui-rtl", stylisPlugins: [prefixer, rtlPlugin] }
          : { key: "mui" }
      }
    >
      <ExamLocaleProvider locale={locale}>
        <ThemeProvider theme={examTheme}>{children}</ThemeProvider>
      </ExamLocaleProvider>
    </AppRouterCacheProvider>
  );
}

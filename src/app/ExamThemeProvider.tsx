"use client";

import type { ReactNode } from "react";
import { ThemeProvider, createTheme } from "@mui/material/styles";

const examTheme = createTheme({
  cssVariables: true,
  palette: {
    mode: "light",
    background: { default: "#F6F8FC", paper: "#FFFFFF" },
    text: { primary: "#172033", secondary: "#526079" },
    primary: { main: "#2847C7", contrastText: "#FFFFFF" },
    secondary: { main: "#526079", contrastText: "#FFFFFF" },
    success: { main: "#0B6B3A", light: "#EAF8F0", contrastText: "#FFFFFF" },
    warning: { main: "#8A4B00", light: "#FFF4E5", contrastText: "#FFFFFF" },
    error: { main: "#B42318", light: "#FFF1F0", contrastText: "#FFFFFF" },
    info: { main: "#175CD3", light: "#EFF4FF", contrastText: "#FFFFFF" },
    divider: "#D0D5DD",
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
    fontFamily: "Roboto, Arial, sans-serif",
    h4: { fontWeight: 750, letterSpacing: "-0.025em" },
    h5: { fontWeight: 750, letterSpacing: "-0.02em" },
    h6: { fontWeight: 700 },
    button: { fontWeight: 700 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: "#F6F8FC",
          userSelect: "none",
          WebkitUserSelect: "none",
        },
      },
    },
    MuiAppBar: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundColor: "#FFFFFF",
          color: "#172033",
          borderBottom: "1px solid #D0D5DD",
        },
      },
    },
    MuiButtonBase: {
      styleOverrides: {
        root: {
          "&:focus-visible": {
            outline: "3px solid #7F56D9",
            outlineOffset: 3,
          },
          "&.Mui-focusVisible": {
            outline: "3px solid #7F56D9",
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
          borderRadius: 10,
          textTransform: "none",
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderColor: "#D0D5DD",
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
          "&:has(input:focus-visible), &:has(textarea:focus-visible)": {
            outline: "3px solid #7F56D9",
            outlineOffset: 3,
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: { root: { fontWeight: 700 } },
    },
    MuiDialog: {
      styleOverrides: { paper: { border: "1px solid #D0D5DD" } },
    },
  },
});

export default function ExamThemeProvider({ children }: { children: ReactNode }) {
  return <ThemeProvider theme={examTheme}>{children}</ThemeProvider>;
}

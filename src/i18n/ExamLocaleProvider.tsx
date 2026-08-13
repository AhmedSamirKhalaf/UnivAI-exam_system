"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  examDirection,
  translateExam,
  type ExamLocale,
  type ExamMessageKey,
  type MessageValues,
} from "@/i18n/exam-locale";

type ExamLocaleContextValue = {
  locale: ExamLocale;
  direction: "ltr" | "rtl";
  t: (key: ExamMessageKey, values?: MessageValues) => string;
};

const ExamLocaleContext = createContext<ExamLocaleContextValue | null>(null);

export function ExamLocaleProvider({
  children,
  locale,
}: {
  children: ReactNode;
  locale: ExamLocale;
}) {
  const value = useMemo<ExamLocaleContextValue>(
    () => ({
      locale,
      direction: examDirection(locale),
      t: (key, values) => translateExam(locale, key, values),
    }),
    [locale],
  );

  return (
    <ExamLocaleContext.Provider value={value}>
      {children}
    </ExamLocaleContext.Provider>
  );
}

export function useExamLocale(): ExamLocaleContextValue {
  const context = useContext(ExamLocaleContext);
  if (!context) {
    throw new Error("useExamLocale must be used inside ExamLocaleProvider");
  }
  return context;
}

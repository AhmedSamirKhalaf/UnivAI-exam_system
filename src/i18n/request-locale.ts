import "server-only";

import { cookies, headers } from "next/headers";
import {
  DEFAULT_EXAM_LOCALE,
  EXAM_LOCALE_COOKIE,
  EXAM_LOCALE_HEADER,
  normalizeExamLocale,
  type ExamLocale,
} from "@/i18n/exam-locale";

export async function getRequestExamLocale(): Promise<ExamLocale> {
  const requestLocale = normalizeExamLocale((await headers()).get(EXAM_LOCALE_HEADER));
  if (requestLocale) return requestLocale;

  const cookieLocale = normalizeExamLocale(
    (await cookies()).get(EXAM_LOCALE_COOKIE)?.value,
  );
  return cookieLocale ?? DEFAULT_EXAM_LOCALE;
}

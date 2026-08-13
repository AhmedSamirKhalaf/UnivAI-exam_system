import { NextResponse, type NextRequest } from "next/server";
import {
  EXAM_LOCALE_COOKIE,
  EXAM_LOCALE_COOKIE_MAX_AGE,
  EXAM_LOCALE_HEADER,
  resolveExamLocale,
} from "@/i18n/exam-locale";

export function proxy(request: NextRequest) {
  const { locale, selectedByQuery } = resolveExamLocale({
    uiLocale: request.nextUrl.searchParams.get("uiLocale"),
    lang: request.nextUrl.searchParams.get("lang"),
    cookie: request.cookies.get(EXAM_LOCALE_COOKIE)?.value,
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(EXAM_LOCALE_HEADER, locale);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  if (selectedByQuery) {
    response.cookies.set({
      name: EXAM_LOCALE_COOKIE,
      value: locale,
      httpOnly: true,
      maxAge: EXAM_LOCALE_COOKIE_MAX_AGE,
      path: "/",
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
    });
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

export const EXAM_LOCALE_COOKIE = "univai_ui_locale";
export const EXAM_LOCALE_HEADER = "x-univai-ui-locale";
export const DEFAULT_EXAM_LOCALE = "en";
export const EXAM_LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export type ExamLocale = "en" | "ar";
export type MessageValues = Record<string, string | number>;

const english = {
  metadataTitle: "UnivAI Exams",
  metadataDescription: "Quizzes and exams for the UnivAI learning simulator",
  skipToMain: "Skip to main content",
  appName: "UnivAI Exams",
  standaloneDevelopmentData: "Standalone development data",
  homeTitle: "UnivAI Exams",
  homeDescription:
    "This service holds the quizzes and exams for a UnivAI course. Students do not browse it directly: the UnivAI app opens an exam here when its window is open.",
  homeAccidental:
    "Arrived here by accident? Go back to the UnivAI app and open your exam from the Exams page — it knows which one is due.",
  scenarioNotStarted: "Not started",
  scenarioActiveAttempt: "Active attempt",
  scenarioSubmittedResult: "Submitted result",
  scenarioPendingManualGrading: "Pending manual grading",
  scenarioFlaggedHumanReview: "Flagged for human review",
  examScenarios: "Exam scenarios",
  scenarioDescription:
    "These fixed scenarios use synthetic identities and project-authored questions. A flagged session records observations and risk for review; it does not declare that a learner cheated.",
  openScenario: "Open scenario",
  viewCapturedWebhooks: "View captured result webhooks",
  pageNotFoundTitle: "Page not found",
  pageNotFoundBody: "The requested exam page is unavailable or the link is invalid.",
  returnHome: "Return to the exam service",
  unexpectedErrorTitle: "Something went wrong",
  unexpectedErrorBody:
    "The exam page could not finish loading. Your server-saved answers are not changed by this screen.",
  tryAgain: "Try again",
  secureConnectionActive: "Secure connection active",
  examLocked: "Exam locked",
  connectionGracePeriod: "Connection grace period",
  reconnecting: "Reconnecting",
  connectingSecurely: "Connecting securely",
  notConnected: "Not connected",
  timerUnavailable: "Timer unavailable",
  sessionActive: "Session active",
  elapsed: "Elapsed {time}",
  unavailable: "unavailable",
  attemptPolicy: "Attempt policy",
  policyQuiz: "Quiz: 2 attempts, 3 hours between attempts",
  policyMidterm: "Midterm: 3 attempts, 5 hours",
  policyFinal: "Final: primary form plus an approved reserve-form retake after 7 days",
  policyUnknown: "Attempt policy unavailable for this assessment type",
  attemptUsage: "Used {used} of {maximum} attempts",
  attemptsRemaining: "{remaining} remaining",
  nextAttemptEligible: "Next attempt eligible at {time}",
  noAttemptsRemain: "No attempts remain for this assessment.",
  attemptNotAvailable: "This attempt is not available yet",
  returnWhenEligible: "Return to UnivAI to start this exam when it becomes eligible.",
  loadExamFallback: "Could not load the exam.",
  loadExamTimeout: "The exam request timed out. Check the server connection and refresh.",
  restoreQuestionFallback: "Could not restore the current question.",
  fullscreenRequiredPause: "Fullscreen is required. The exam is paused until you return to fullscreen.",
  developerToolsDetected: "Developer tools or a large browser panel were detected. Close them to continue.",
  closeDeveloperToolsBeforeStart: "Close developer tools or large browser panels before starting the exam.",
  fullscreenBrowserRequired: "Fullscreen is required to take this exam. Use a browser that supports fullscreen.",
  fullscreenCouldNotStart: "Fullscreen could not start. Allow fullscreen, then try again.",
  examRemainsPaused: "The exam remains paused. Allow fullscreen, then try again.",
  saveAnswerFallback: "Could not save the answer.",
  questionSkippedSaved: "Question skipped and saved on the server.",
  answerSaved: "Answer saved on the server.",
  submissionFailed: "Submission failed.",
  couldNotOpenExam: "Could not open the exam",
  loadingExam: "Loading exam",
  preparingExam: "Preparing your exam…",
  submissionReceived: "Submission received",
  answersStored: "Your accepted answers are stored on the server. You can safely leave this page.",
  resultHeldForReview: "Result held for integrity review",
  reviewStateExplanation:
    "This is a review state, not an automatic claim. Open UnivAI to see the recorded result and request support or an appeal.",
  manualGrading: "Manual grading in progress",
  resultAfterReview: "Your final result will appear in UnivAI after review.",
  passed: "Passed",
  gradingComplete: "Grading complete",
  scoreAndPassingMark: "Score: {score} · Passing mark: {passingMark}",
  scoreOnly: "Score: {score}",
  resultReady: "Your result is ready in UnivAI.",
  submissionCompleted: "Submission completed.",
  openResults: "Open results in UnivAI",
  goToDashboard: "Go to dashboard",
  requestReview: "Request review or appeal",
  examPausedForReview: "Exam paused for review",
  acceptedAnswersPreserved: "Your accepted answers are preserved",
  serverPausedAttempt: "The server paused this attempt after an integrity protocol failure.",
  noCheatingVerdict:
    "This screen reports what happened; it does not declare a cheating verdict. Return to UnivAI for the review, resume, or appeal path.",
  openReviewOptions: "Open review options in UnivAI",
  examPausedFullscreen: "Exam paused — fullscreen required",
  leftFullscreen: "You left fullscreen",
  fullscreenControlsBlocked: "Questions and answer controls are blocked. Return to fullscreen to continue this attempt.",
  preservedWhilePaused:
    "Answers already accepted by the server are preserved. Closing this message or pressing Escape cannot resume the exam.",
  returnToFullscreen: "Return to fullscreen",
  examPausedDeveloperTools: "Exam paused — close developer tools",
  developerToolsOpen: "Developer tools or a large browser panel are open",
  developerToolsControlsBlocked:
    "Questions and answer controls are blocked. Close the panel and restore the browser window to continue.",
  automaticDeveloperToolsCheck:
    "The check runs automatically. Your accepted answers and the secure heartbeat remain active while this screen is shown.",
  quizLabel: "Quiz",
  midtermLabel: "Midterm",
  finalLabel: "Final",
  practiceLabel: "Practice",
  questionCount: "{count} questions",
  readinessIntroduction: "A short readiness check gives you one clear road into the exam.",
  stepRules: "Rules",
  stepRulesDescription: "Read the exam policy",
  stepReady: "Ready",
  stepReadyDescription: "Check this browser",
  stepExam: "Exam",
  stepExamDescription: "Answer one question at a time",
  integrityAndPrivacy: "Integrity and privacy",
  monitoringNotice:
    "The exam records blocked copy, tab, fullscreen, and developer-tool actions plus connection health. It does not collect typed key contents, clipboard contents, or continuous pointer movement.",
  examRules: "Exam rules",
  stayInExamWindow: "Stay in this exam window",
  stayInExamWindowDetail: "Leaving fullscreen immediately pauses and blocks the exam until fullscreen is restored.",
  answerCurrentQuestion: "Answer the current question",
  answerCurrentQuestionDetail: "The server sends the next question only after this answer or skip is accepted.",
  knowMcqScoring: "Know the MCQ scoring",
  knowMcqScoringDetail: "Correct: +1. Wrong: -1. Blank or skipped: 0. Your total can never fall below 0.",
  waitForSaved: "Wait for saved confirmation",
  waitForSavedDetail: "Move forward only after the answer is safely stored on the server.",
  acknowledgeRules: "I understand the rules and monitoring notice.",
  continueToReadiness: "Continue to readiness",
  readyThisBrowser: "Ready this browser",
  readyBrowserDetail:
    "Close unrelated tabs and apps, use a stable connection, and allow fullscreen. A secure integrity connection will open before the first question becomes usable.",
  closeDeveloperToolsFirst: "Close developer tools first",
  closeDeveloperToolsDetail:
    "Developer tools or a large browser panel were detected. The start button will unlock automatically after the panel closes.",
  backToRules: "Back to rules",
  enterFullscreenAndStart: "Enter fullscreen and start",
  examInProgress: "{type} in progress",
  questionPosition: "Question {position} of {total}",
  examCompletion: "Exam completion",
  acceptedProgress: "{answered} of {total} answers or skips accepted by the server",
  integrityMonitoringOn: "Integrity monitoring on",
  blockedActions: "{count} blocked actions",
  connectionInterrupted: "Connection interrupted",
  openingSecureConnection: "Opening the secure connection",
  gracePeriodDetail:
    "The server is preserving accepted answers during the grace period. Question actions stay paused until reconnection.",
  reconnectingDetail: "Your current input stays on screen. Wait for the connected confirmation before continuing.",
  connectingDetail: "The current question will be enabled after the signed heartbeat is accepted.",
  actionBlockedRecorded: "Action blocked and recorded",
  close: "Close",
  currentQuestion: "Current question",
  chooseOneAnswer: "Choose one answer",
  yourAnswer: "Your answer",
  answerSaveHelper: "Your answer moves forward only after the server confirms it was saved.",
  skipAndSave: "Skip and save",
  saving: "Saving…",
  saveAndContinue: "Save and continue",
  restoringQuestion: "Restoring current question",
  restoringCurrentQuestion: "Restoring the current question",
  restoringDetail: "The secure connection is active. Waiting for the server-owned question state.",
  everyQuestionComplete: "Every question is complete",
  everyQuestionCompleteDetail:
    "The server accepted {total} answers or explicit skips. Review the finality notice before submitting.",
  reviewAndSubmit: "Review and submit",
  actionNotCompleted: "Action not completed",
  submitExamQuestion: "Submit this exam?",
  submissionFinality:
    "The server accepted all {total} questions. Submission is final, and you cannot change an answer afterward.",
  keepWorking: "Keep working",
  submitting: "Submitting…",
  submitExam: "Submit exam",
  shortcutDisabled: "{shortcut} is disabled during an active exam.",
  rightClickDisabled: "Right-click is disabled during an active exam.",
  copyAction: "Copy",
  cutAction: "Cut",
  pasteAction: "Paste",
  clipboardDisabled: "{action} is disabled during an active exam.",
  draggingDisabled: "Dragging exam content is disabled.",
  droppingDisabled: "Dropping content into the exam is disabled.",
  leavingPageWarning: "Leaving this page can pause your exam. Use the exam controls instead.",
  printingDisabled: "Printing is not allowed during an active exam.",
  anotherTabWarning: "Another tab opened this exam. The server may lock this attempt.",
  genericLocalizedError: "The requested exam action could not be completed. Please try again.",
  errorActiveSessionMissing: "Active exam session not found",
  errorTokenRequired: "Exam access token is required",
  errorTokenInvalid: "Exam access token is invalid",
  errorFinalWindowEnded:
    "This final-exam window has ended. You can request a retake from UnivAI during the next 14 days.",
  errorExamNotFound: "Exam not found",
  errorAlreadySubmitted: "Exam already submitted",
  errorSessionInactive: "Exam session is not active",
  errorQuestionsComplete: "All questions are already complete",
  errorQuestionNotCurrent: "Question is not the current server question",
  errorRevisionStale: "Answer revision is stale",
  errorAnswerStateChanged: "Answer state changed; reload the current question",
  errorQuestionsRequired: "Every question must be answered or skipped before submission",
  errorAttemptActive: "An attempt is already active for this assessment",
  errorCooldown: "Cooldown active — the next attempt is not yet eligible",
  errorMaximumAttempts: "Maximum attempts reached for this assessment",
  errorUnknownAssessment: "Unknown assessment type",
  errorAttemptIneligible: "The attempt is not eligible to start",
  errorIntegrityLocked: "Exam integrity was locked by the server.",
  errorSecondConnection: "A second active exam connection was opened",
  errorGraceExpired: "Integrity channel did not reconnect before grace expired",
  errorInvalidRequest: "Invalid request",
} as const;

export type ExamMessageKey = keyof typeof english;

const arabic: Record<ExamMessageKey, string> = {
  metadataTitle: "اختبارات UnivAI",
  metadataDescription: "الاختبارات القصيرة والنهائية لمحاكي التعلّم UnivAI",
  skipToMain: "تخطَّ إلى المحتوى الرئيسي",
  appName: "اختبارات UnivAI",
  standaloneDevelopmentData: "بيانات تطوير مستقلة",
  homeTitle: "اختبارات UnivAI",
  homeDescription:
    "تستضيف هذه الخدمة الاختبارات القصيرة والنهائية لمقرر UnivAI. لا يتصفحها الطلاب مباشرة؛ إذ يفتح تطبيق UnivAI الاختبار هنا عندما يحين موعده.",
  homeAccidental:
    "هل وصلت إلى هنا بالخطأ؟ ارجع إلى تطبيق UnivAI وافتح اختبارك من صفحة الاختبارات؛ فهي تعرف الاختبار المستحق.",
  scenarioNotStarted: "لم يبدأ",
  scenarioActiveAttempt: "محاولة نشطة",
  scenarioSubmittedResult: "نتيجة مُرسلة",
  scenarioPendingManualGrading: "بانتظار التصحيح اليدوي",
  scenarioFlaggedHumanReview: "مُحال إلى المراجعة البشرية",
  examScenarios: "سيناريوهات الاختبار",
  scenarioDescription:
    "تستخدم هذه السيناريوهات الثابتة هويات اصطناعية وأسئلة أعدّها المشروع. تسجّل الجلسة المُحالة الملاحظات ومستوى المخاطر للمراجعة، ولا تقرر أن المتعلم قد غش.",
  openScenario: "فتح السيناريو",
  viewCapturedWebhooks: "عرض إشعارات النتائج الملتقطة",
  pageNotFoundTitle: "الصفحة غير موجودة",
  pageNotFoundBody: "صفحة الاختبار المطلوبة غير متاحة أو أن الرابط غير صالح.",
  returnHome: "العودة إلى خدمة الاختبارات",
  unexpectedErrorTitle: "حدث خطأ",
  unexpectedErrorBody:
    "تعذر إكمال تحميل صفحة الاختبار. لا تتغير إجاباتك المحفوظة على الخادم بسبب هذه الشاشة.",
  tryAgain: "إعادة المحاولة",
  secureConnectionActive: "الاتصال الآمن نشط",
  examLocked: "الاختبار مقفل",
  connectionGracePeriod: "فترة سماح للاتصال",
  reconnecting: "جارٍ إعادة الاتصال",
  connectingSecurely: "جارٍ إنشاء اتصال آمن",
  notConnected: "غير متصل",
  timerUnavailable: "المؤقت غير متاح",
  sessionActive: "الجلسة نشطة",
  elapsed: "الوقت المنقضي {time}",
  unavailable: "غير متاح",
  attemptPolicy: "سياسة المحاولات",
  policyQuiz: "اختبار قصير: محاولتان، وبينهما 3 ساعات",
  policyMidterm: "اختبار منتصف الفصل: 3 محاولات، وبينها 5 ساعات",
  policyFinal: "اختبار نهائي: نموذج أساسي ومحاولة معتمدة بنموذج احتياطي بعد 7 أيام",
  policyUnknown: "سياسة المحاولات غير متاحة لهذا النوع من التقييم",
  attemptUsage: "استُخدمت {used} من أصل {maximum} محاولات",
  attemptsRemaining: "المتبقي: {remaining}",
  nextAttemptEligible: "تتاح المحاولة التالية في {time}",
  noAttemptsRemain: "لا توجد محاولات متبقية لهذا التقييم.",
  attemptNotAvailable: "هذه المحاولة غير متاحة بعد",
  returnWhenEligible: "ارجع إلى UnivAI لبدء هذا الاختبار عندما تصبح المحاولة متاحة.",
  loadExamFallback: "تعذر تحميل الاختبار.",
  loadExamTimeout: "انتهت مهلة طلب الاختبار. تحقق من اتصال الخادم وحدّث الصفحة.",
  restoreQuestionFallback: "تعذرت استعادة السؤال الحالي.",
  fullscreenRequiredPause: "وضع ملء الشاشة مطلوب. الاختبار متوقف حتى تعود إلى ملء الشاشة.",
  developerToolsDetected: "رُصدت أدوات المطور أو لوحة متصفح كبيرة. أغلقها للمتابعة.",
  closeDeveloperToolsBeforeStart: "أغلق أدوات المطور أو لوحات المتصفح الكبيرة قبل بدء الاختبار.",
  fullscreenBrowserRequired: "وضع ملء الشاشة مطلوب لهذا الاختبار. استخدم متصفحًا يدعم ملء الشاشة.",
  fullscreenCouldNotStart: "تعذر تشغيل ملء الشاشة. اسمح به ثم حاول مرة أخرى.",
  examRemainsPaused: "ما زال الاختبار متوقفًا. اسمح بملء الشاشة ثم حاول مرة أخرى.",
  saveAnswerFallback: "تعذر حفظ الإجابة.",
  questionSkippedSaved: "تم تخطي السؤال وحفظ ذلك على الخادم.",
  answerSaved: "تم حفظ الإجابة على الخادم.",
  submissionFailed: "تعذر إرسال الاختبار.",
  couldNotOpenExam: "تعذر فتح الاختبار",
  loadingExam: "جارٍ تحميل الاختبار",
  preparingExam: "جارٍ تجهيز اختبارك…",
  submissionReceived: "تم استلام الإرسال",
  answersStored: "إجاباتك المقبولة محفوظة على الخادم. يمكنك مغادرة هذه الصفحة بأمان.",
  resultHeldForReview: "النتيجة معلّقة لمراجعة النزاهة",
  reviewStateExplanation:
    "هذه حالة مراجعة وليست اتهامًا تلقائيًا. افتح UnivAI لرؤية النتيجة المسجلة وطلب الدعم أو تقديم تظلم.",
  manualGrading: "التصحيح اليدوي جارٍ",
  resultAfterReview: "ستظهر نتيجتك النهائية في UnivAI بعد المراجعة.",
  passed: "ناجح",
  gradingComplete: "اكتمل التصحيح",
  scoreAndPassingMark: "الدرجة: {score} · درجة النجاح: {passingMark}",
  scoreOnly: "الدرجة: {score}",
  resultReady: "نتيجتك جاهزة في UnivAI.",
  submissionCompleted: "اكتمل إرسال الاختبار.",
  openResults: "فتح النتائج في UnivAI",
  goToDashboard: "الذهاب إلى لوحة التحكم",
  requestReview: "طلب مراجعة أو تقديم تظلم",
  examPausedForReview: "أُوقف الاختبار للمراجعة",
  acceptedAnswersPreserved: "إجاباتك المقبولة محفوظة",
  serverPausedAttempt: "أوقف الخادم هذه المحاولة بعد تعطل بروتوكول النزاهة.",
  noCheatingVerdict:
    "توضح هذه الشاشة ما حدث، ولا تصدر حكمًا بوقوع غش. ارجع إلى UnivAI للوصول إلى مسار المراجعة أو الاستئناف أو التظلم.",
  openReviewOptions: "فتح خيارات المراجعة في UnivAI",
  examPausedFullscreen: "الاختبار متوقف — ملء الشاشة مطلوب",
  leftFullscreen: "لقد غادرت وضع ملء الشاشة",
  fullscreenControlsBlocked: "الأسئلة وعناصر الإجابة محجوبة. عُد إلى ملء الشاشة لمتابعة هذه المحاولة.",
  preservedWhilePaused:
    "الإجابات التي قبلها الخادم محفوظة. لا يؤدي إغلاق هذه الرسالة أو ضغط Escape إلى استئناف الاختبار.",
  returnToFullscreen: "العودة إلى ملء الشاشة",
  examPausedDeveloperTools: "الاختبار متوقف — أغلق أدوات المطور",
  developerToolsOpen: "أدوات المطور أو لوحة متصفح كبيرة مفتوحة",
  developerToolsControlsBlocked:
    "الأسئلة وعناصر الإجابة محجوبة. أغلق اللوحة وأعد نافذة المتصفح إلى وضعها الطبيعي للمتابعة.",
  automaticDeveloperToolsCheck:
    "يعمل الفحص تلقائيًا. تظل إجاباتك المقبولة ونبضات الاتصال الآمن نشطة أثناء ظهور هذه الشاشة.",
  quizLabel: "اختبار قصير",
  midtermLabel: "اختبار منتصف الفصل",
  finalLabel: "اختبار نهائي",
  practiceLabel: "تدريب",
  questionCount: "عدد الأسئلة: {count}",
  readinessIntroduction: "ينقلك فحص استعداد قصير عبر مسار واضح واحد إلى الاختبار.",
  stepRules: "القواعد",
  stepRulesDescription: "اقرأ سياسة الاختبار",
  stepReady: "الاستعداد",
  stepReadyDescription: "تحقق من هذا المتصفح",
  stepExam: "الاختبار",
  stepExamDescription: "أجب عن سؤال واحد في كل مرة",
  integrityAndPrivacy: "النزاهة والخصوصية",
  monitoringNotice:
    "يسجّل الاختبار محاولات النسخ المحظورة وتبديل علامات التبويب والخروج من ملء الشاشة واستخدام أدوات المطور، إضافة إلى حالة الاتصال. ولا يجمع محتوى ضغطات المفاتيح أو الحافظة أو حركة المؤشر المستمرة.",
  examRules: "قواعد الاختبار",
  stayInExamWindow: "ابقَ في نافذة الاختبار",
  stayInExamWindowDetail: "تؤدي مغادرة ملء الشاشة إلى إيقاف الاختبار وحجبه فورًا حتى استعادة ملء الشاشة.",
  answerCurrentQuestion: "أجب عن السؤال الحالي",
  answerCurrentQuestionDetail: "لا يرسل الخادم السؤال التالي إلا بعد قبول هذه الإجابة أو قبول التخطي.",
  knowMcqScoring: "اعرف طريقة تصحيح الاختيار من متعدد",
  knowMcqScoringDetail: "الصحيح: +1. الخطأ: -1. الفارغ أو المتخطى: 0. لا يمكن أن يقل مجموعك عن 0.",
  waitForSaved: "انتظر تأكيد الحفظ",
  waitForSavedDetail: "انتقل إلى الأمام فقط بعد حفظ الإجابة بأمان على الخادم.",
  acknowledgeRules: "أفهم القواعد وإشعار المراقبة.",
  continueToReadiness: "المتابعة إلى فحص الاستعداد",
  readyThisBrowser: "جهّز هذا المتصفح",
  readyBrowserDetail:
    "أغلق علامات التبويب والتطبيقات غير المتعلقة، واستخدم اتصالًا مستقرًا، واسمح بملء الشاشة. سيُفتح اتصال نزاهة آمن قبل إتاحة السؤال الأول.",
  closeDeveloperToolsFirst: "أغلق أدوات المطور أولًا",
  closeDeveloperToolsDetail:
    "رُصدت أدوات المطور أو لوحة متصفح كبيرة. سيتاح زر البدء تلقائيًا بعد إغلاق اللوحة.",
  backToRules: "العودة إلى القواعد",
  enterFullscreenAndStart: "الدخول إلى ملء الشاشة والبدء",
  examInProgress: "{type} جارٍ",
  questionPosition: "السؤال {position} من {total}",
  examCompletion: "نسبة إكمال الاختبار",
  acceptedProgress: "قبل الخادم {answered} من أصل {total} إجابات أو عمليات تخطٍ",
  integrityMonitoringOn: "مراقبة النزاهة مفعّلة",
  blockedActions: "الإجراءات المحظورة: {count}",
  connectionInterrupted: "انقطع الاتصال",
  openingSecureConnection: "جارٍ فتح الاتصال الآمن",
  gracePeriodDetail:
    "يحافظ الخادم على الإجابات المقبولة خلال فترة السماح. تظل إجراءات السؤال متوقفة حتى عودة الاتصال.",
  reconnectingDetail: "يبقى إدخالك الحالي ظاهرًا. انتظر تأكيد الاتصال قبل المتابعة.",
  connectingDetail: "سيُتاح السؤال الحالي بعد قبول نبضات الاتصال الموقعة.",
  actionBlockedRecorded: "تم حظر الإجراء وتسجيله",
  close: "إغلاق",
  currentQuestion: "السؤال الحالي",
  chooseOneAnswer: "اختر إجابة واحدة",
  yourAnswer: "إجابتك",
  answerSaveHelper: "لن تنتقل إجابتك إلى الأمام إلا بعد تأكيد الخادم حفظها.",
  skipAndSave: "التخطي والحفظ",
  saving: "جارٍ الحفظ…",
  saveAndContinue: "الحفظ والمتابعة",
  restoringQuestion: "جارٍ استعادة السؤال الحالي",
  restoringCurrentQuestion: "استعادة السؤال الحالي",
  restoringDetail: "الاتصال الآمن نشط. جارٍ انتظار حالة السؤال التي يديرها الخادم.",
  everyQuestionComplete: "اكتملت جميع الأسئلة",
  everyQuestionCompleteDetail:
    "قبل الخادم {total} إجابات أو عمليات تخطٍ صريحة. راجع إشعار نهائية الإرسال قبل المتابعة.",
  reviewAndSubmit: "المراجعة والإرسال",
  actionNotCompleted: "لم يكتمل الإجراء",
  submitExamQuestion: "هل تريد إرسال هذا الاختبار؟",
  submissionFinality:
    "قبل الخادم جميع الأسئلة وعددها {total}. الإرسال نهائي، ولن تتمكن من تغيير أي إجابة بعده.",
  keepWorking: "متابعة العمل",
  submitting: "جارٍ الإرسال…",
  submitExam: "إرسال الاختبار",
  shortcutDisabled: "الاختصار {shortcut} معطّل أثناء الاختبار النشط.",
  rightClickDisabled: "النقر بزر الفأرة الأيمن معطّل أثناء الاختبار النشط.",
  copyAction: "النسخ",
  cutAction: "القص",
  pasteAction: "اللصق",
  clipboardDisabled: "إجراء {action} معطّل أثناء الاختبار النشط.",
  draggingDisabled: "سحب محتوى الاختبار معطّل.",
  droppingDisabled: "إفلات المحتوى داخل الاختبار معطّل.",
  leavingPageWarning: "قد تؤدي مغادرة هذه الصفحة إلى إيقاف اختبارك. استخدم عناصر تحكم الاختبار بدلًا من ذلك.",
  printingDisabled: "الطباعة غير مسموح بها أثناء الاختبار النشط.",
  anotherTabWarning: "فتحت علامة تبويب أخرى هذا الاختبار. قد يقفل الخادم هذه المحاولة.",
  genericLocalizedError: "تعذر إكمال إجراء الاختبار المطلوب. حاول مرة أخرى.",
  errorActiveSessionMissing: "لم يتم العثور على جلسة اختبار نشطة",
  errorTokenRequired: "رمز الوصول إلى الاختبار مطلوب",
  errorTokenInvalid: "رمز الوصول إلى الاختبار غير صالح",
  errorFinalWindowEnded: "انتهت نافذة الاختبار النهائي. يمكنك طلب إعادة من UnivAI خلال الأيام الأربعة عشر التالية.",
  errorExamNotFound: "لم يتم العثور على الاختبار",
  errorAlreadySubmitted: "تم إرسال الاختبار بالفعل",
  errorSessionInactive: "جلسة الاختبار غير نشطة",
  errorQuestionsComplete: "اكتملت جميع الأسئلة بالفعل",
  errorQuestionNotCurrent: "السؤال ليس السؤال الحالي لدى الخادم",
  errorRevisionStale: "نسخة الإجابة قديمة",
  errorAnswerStateChanged: "تغيّرت حالة الإجابة؛ أعد تحميل السؤال الحالي",
  errorQuestionsRequired: "يجب الإجابة عن كل سؤال أو تخطيه قبل الإرسال",
  errorAttemptActive: "توجد محاولة نشطة بالفعل لهذا التقييم",
  errorCooldown: "فترة الانتظار نشطة — المحاولة التالية غير متاحة بعد",
  errorMaximumAttempts: "تم الوصول إلى الحد الأقصى لمحاولات هذا التقييم",
  errorUnknownAssessment: "نوع التقييم غير معروف",
  errorAttemptIneligible: "المحاولة غير مؤهلة للبدء",
  errorIntegrityLocked: "قفل الخادم الاختبار لأسباب تتعلق بالنزاهة.",
  errorSecondConnection: "فُتح اتصال ثانٍ نشط للاختبار",
  errorGraceExpired: "لم يعد اتصال النزاهة قبل انتهاء فترة السماح",
  errorInvalidRequest: "الطلب غير صالح",
};

const dictionaries: Record<ExamLocale, Record<ExamMessageKey, string>> = {
  en: english,
  ar: arabic,
};

const serverErrorKeys: Record<string, ExamMessageKey> = {
  "Active exam session not found": "errorActiveSessionMissing",
  "Exam access token is required": "errorTokenRequired",
  "Exam access token is invalid": "errorTokenInvalid",
  "This final-exam window has ended. You can request a retake from UnivAI during the next 14 days.":
    "errorFinalWindowEnded",
  "Exam not found": "errorExamNotFound",
  "Exam already submitted": "errorAlreadySubmitted",
  "Exam session is not active": "errorSessionInactive",
  "All questions are already complete": "errorQuestionsComplete",
  "Question is not the current server question": "errorQuestionNotCurrent",
  "Answer revision is stale": "errorRevisionStale",
  "Answer state changed; reload the current question": "errorAnswerStateChanged",
  "Every question must be answered or skipped before submission": "errorQuestionsRequired",
  "An attempt is already active for this assessment": "errorAttemptActive",
  "Cooldown active — the next attempt is not yet eligible": "errorCooldown",
  "Maximum attempts reached for this assessment": "errorMaximumAttempts",
  "Unknown assessment type": "errorUnknownAssessment",
  "The attempt is not eligible to start": "errorAttemptIneligible",
  "Exam integrity was locked by the server.": "errorIntegrityLocked",
  "A second active exam connection was opened": "errorSecondConnection",
  "Integrity channel did not reconnect before grace expired": "errorGraceExpired",
  "Invalid request": "errorInvalidRequest",
};

export function normalizeExamLocale(value: string | null | undefined): ExamLocale | null {
  const normalized = value?.trim().toLowerCase().replace("_", "-");
  if (!normalized) return null;
  if (normalized === "ar" || normalized.startsWith("ar-")) return "ar";
  if (normalized === "en" || normalized.startsWith("en-")) return "en";
  return null;
}

export function resolveExamLocale(input: {
  uiLocale?: string | null;
  lang?: string | null;
  cookie?: string | null;
}): { locale: ExamLocale; selectedByQuery: boolean } {
  const queryLocale = normalizeExamLocale(input.uiLocale) ?? normalizeExamLocale(input.lang);
  if (queryLocale) return { locale: queryLocale, selectedByQuery: true };
  return {
    locale: normalizeExamLocale(input.cookie) ?? DEFAULT_EXAM_LOCALE,
    selectedByQuery: false,
  };
}

export function examDirection(locale: ExamLocale): "ltr" | "rtl" {
  return locale === "ar" ? "rtl" : "ltr";
}

export function translateExam(
  locale: ExamLocale,
  key: ExamMessageKey,
  values: MessageValues = {},
): string {
  return dictionaries[locale][key].replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : placeholder,
  );
}

export function localizePolicyStatement(
  locale: ExamLocale,
  assessmentType: "quiz" | "mid" | "final" | "unknown",
  englishStatement?: string,
): string {
  if (locale === "en" && englishStatement) return englishStatement;
  if (assessmentType === "quiz") return translateExam(locale, "policyQuiz");
  if (assessmentType === "mid") return translateExam(locale, "policyMidterm");
  if (assessmentType === "final") return translateExam(locale, "policyFinal");
  return translateExam(locale, "policyUnknown");
}

export function localizeServerMessage(
  locale: ExamLocale,
  value: unknown,
  fallbackKey: ExamMessageKey = "genericLocalizedError",
): string {
  const message = typeof value === "string" ? value.trim() : "";
  if (locale === "en") return message || translateExam(locale, fallbackKey);
  if (/\p{Script=Arabic}/u.test(message)) return message;
  const key = serverErrorKeys[message];
  return key ? translateExam(locale, key) : translateExam(locale, fallbackKey);
}

export function formatExamDateTime(locale: ExamLocale, value: Date): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

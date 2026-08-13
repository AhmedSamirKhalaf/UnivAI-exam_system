# Exam UI decisions

The exam UI follows one visible road: rules, browser readiness, secure connection, one current question, server save confirmation, final submit, and result or review entry. It is built from MUI components and one centralized theme; there are no custom CSS files, `sx`, or `styled()` calls.

The website shell is available in English and Arabic. `uiLocale` takes priority over `lang` on an incoming URL, a valid choice is persisted in a secure HTTP-only preference cookie, and the surrounding document and MUI theme switch between LTR and RTL. Exam titles, generated prompts, answer options, and other generated assessment content remain immutable English content islands marked `lang="en" dir="ltr"`; localization never rewrites assessment material.

The accessibility measures below are foundations for WCAG 2.2 AAA readiness, not a certification or a claim that every AAA success criterion is satisfied. Conformance still requires complete automated and manual audits, including assistive-technology and accommodation testing.

## Components and behavior

| State | MUI components | Exact behavior |
|---|---|---|
| Rules and readiness | `Stepper`, `Alert`, `Checkbox`, `List`, `Button` | Explains monitoring and privacy, requires acknowledgement, requests fullscreen, then opens the integrity channel. |
| Exam header | `Card`, `Chip`, `LinearProgress` | Keeps exact question position, accepted-answer count, elapsed session time, and text-labeled connection state together. The timer text does not move or flash. |
| Current question | `Card`, `RadioGroup` or `TextField` | Shows one server-delivered question. Answer controls stay disabled until the signed channel is active. |
| Saved and connection feedback | `Collapse`, `Alert` | Uses `role="status"` for routine saved/reconnect messages and `role="alert"` for blocked actions and failures. |
| Submit | `Dialog`, `Button` | States that submission is final and requires a second explicit action. |
| Result and review | `Alert`, `Chip`, `Button` | Separates graded, pending, and integrity-review states. Integrity language reports a review state and provides a UnivAI review/appeal entry; it never says the UI proved cheating. |

Status messages follow [WCAG 2.2 status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html). Text or an icon always accompanies color, following [WCAG use of color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html).

## Theme and contrast

| Purpose | Foreground | Background | Checked ratio |
|---|---:|---:|---:|
| Main text | `#172033` | `#FFFFFF` | 16.27:1 |
| Secondary text | `#44516A` | `#FFFFFF` | 7.98:1 |
| Primary action | `#FFFFFF` | `#2847C7` | 7.46:1 |
| Success | `#075A31` | `#EAF8F0` | 7.63:1 |
| Warning | `#6B3900` | `#FFF4E5` | 8.74:1 |
| Error or lock | `#8A1C13` | `#FFF1F0` | 8.46:1 |
| Information | `#0E4691` | `#EFF4FF` | 8.27:1 |
| Keyboard focus | `#512DA8` | `#FFFFFF` | 9.17:1 |
| Essential boundary | `#667085` | `#FFFFFF` | 4.98:1 |

The focus indicator is a three-pixel outline with an offset. The listed normal-text pairs reach the 7:1 enhanced-contrast target, while essential boundaries exceed 3:1: [contrast enhanced](https://www.w3.org/WAI/WCAG22/Understanding/contrast-enhanced.html), [non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html), and [focus visible](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html).

## Motion

| Feedback | Component | Duration |
|---|---|---:|
| New question/content | `Fade` | 225 ms enter, 195 ms exit |
| Saved/error/connection message | `Collapse` | 180-200 ms |
| Dialog | MUI theme transition | 225 ms enter, 195 ms leave |
| Progress | `LinearProgress` | MUI short transition, at most 200 ms |
| Elapsed timer | Text only | No positional or color animation |

MUI's theme durations follow its [transition guidance](https://mui.com/material-ui/customization/transitions/). `theme.motion.reducedMotion` follows the system preference, so MUI removes transitions while preserving lifecycle behavior. This follows [W3C technique C39](https://www.w3.org/WAI/WCAG22/Techniques/css/C39) for `prefers-reduced-motion`.

## Verification evidence

The Playwright check uses keyboard navigation, desktop and phone viewports, and an emulated reduced-motion preference. It captures:

- `evidence/exam-ui/readiness-desktop.png`
- `evidence/exam-ui/current-question-desktop.png`
- `evidence/exam-ui/submitted-mobile-reduced-motion.png`
- `evidence/exam-ui/integrity-review-desktop.png`

Run it against a built running server with `BASE_URL` set. In integrated mode, also provide a locally issued test token through `EVIDENCE_ATTEMPT_TOKEN`, then run `npx playwright test tests/e2e/exam-ui.spec.ts --workers=1`.

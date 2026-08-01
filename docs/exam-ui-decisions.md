# Exam UI decisions

The exam UI follows one visible road: rules, browser readiness, secure connection, one current question, server save confirmation, final submit, and result or review entry. It is built from MUI components and one centralized theme; there are no custom CSS files, `sx`, or `styled()` calls.

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
| Secondary text | `#526079` | `#FFFFFF` | 6.35:1 |
| Primary action | `#FFFFFF` | `#2847C7` | 7.46:1 |
| Success | `#0B6B3A` | `#EAF8F0` | 6.04:1 |
| Warning | `#8A4B00` | `#FFF4E5` | 6.26:1 |
| Error or lock | `#B42318` | `#FFF1F0` | 5.98:1 |
| Information | `#175CD3` | `#EFF4FF` | 5.43:1 |
| Keyboard focus | `#7F56D9` | `#FFFFFF` | 4.96:1 |

The focus indicator is a three-pixel outline with an offset. These choices exceed WCAG AA's 4.5:1 normal-text and 3:1 user-interface boundaries: [contrast minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html), and [focus visible](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html).

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

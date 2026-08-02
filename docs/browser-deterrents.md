# Browser exam deterrents

These controls reduce casual misuse and create an evidence trail. They do not make a normal webpage able to control browser menus, extensions, remote debugging, operating-system shortcuts, or a second device.

## Blocked and recorded actions

- Chrome and Edge: `F12`, `Ctrl+Shift+I/J/C`, macOS `Command+Option+I/J/C`, and view source.
- Firefox: `F12`, `Ctrl+Shift+I/K/C/J/Z` and macOS equivalents.
- Safari: `Command+Option+I/C/U` where the browser exposes those shortcuts to the page.
- `PrintScreen` is recorded when the browser delivers the key event, but the operating system can handle it before the page.
- Context menu, copy, cut, paste, drag, drop, and print attempts.

Every blocked action shows text feedback. No key contents, clipboard contents, answer contents, selected text, DOM snapshot, browser history, or device label is sent.

## Supporting context

Visibility, focus, fullscreen, page lifecycle, network state, resize, CSP violations, same-origin exam storage changes, duplicate tabs, and media-device counts are recorded with minimum metadata. One focus loss immediately flags the attempt for human review; it does not invalidate or terminate the attempt.

Resize/docked-DevTools detection is low confidence, so it cannot invalidate an exam by itself. Two matching samples pause and hide the exam controls, including when the panel was already open before the exam page loaded. Two clean samples automatically remove the pause. The signed heartbeat remains active throughout this reversible gate.

## Deliberate exclusions

A main-page script runs a small IIFE with a repeated `debugger` statement. The statement is effectively inert without an attached inspector and repeatedly pauses the exam UI when an inspector is listening, including undocked/window-mode DevTools. Resuming execution schedules another pause 1.25 seconds later. Closing DevTools lets the script continue normally.

This is only a deterrent: disabling breakpoints can bypass it, and the pause is not treated as proof of misconduct by itself. A held breakpoint also pauses main-thread answer saving and heartbeat activity; already accepted answers remain server-owned, and the existing connection grace and review flow apply. Text selection is not blocked because selection is useful to accessibility tools and is not itself a violation. Continuous pointer movement and raw keystrokes are not collected.

Primary references:

- https://developer.chrome.com/docs/devtools/shortcuts/
- https://learn.microsoft.com/en-us/microsoft-edge/devtools/overview
- https://firefox-source-docs.mozilla.org/devtools-user/keyboard_shortcuts/index.html
- https://developer.apple.com/videos/play/wwdc2023/10118/
- https://tc39.es/ecma262/#sec-debugger-statement
- https://www.w3.org/TR/uievents/
- https://www.w3.org/TR/clipboard-apis/
- https://www.w3.org/TR/page-visibility-2/
- https://fullscreen.spec.whatwg.org/

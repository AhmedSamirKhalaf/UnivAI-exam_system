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

Visibility, focus, fullscreen, page lifecycle, network state, resize, CSP violations, same-origin exam storage changes, duplicate tabs, and media-device counts are recorded with minimum metadata. Resize/docked-DevTools detection is low confidence and can never lock an exam by itself.

## Deliberate exclusions

There is no repeated `debugger` statement. It is bypassable, implementation-defined, and pauses the answer-saving and heartbeat JavaScript that protects the attempt. Text selection is not blocked because selection is useful to accessibility tools and is not itself a violation. Continuous pointer movement and raw keystrokes are not collected.

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

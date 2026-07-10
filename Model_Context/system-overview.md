# What's In This System — Plain Summary

A quick overview, no jargon, so the full picture is easy to hold in your
head. For exact fields, see `schema-design.md`. For code-level details, see
`migration-automation-camera-appeals.md`.

---

## The whole flow, in order

1. **Student enrolls** in a curriculum (a course). Can't touch any exam
   before this.

2. **Student takes quizzes**, one per chapter, MCQ only, auto-graded
   instantly. Retaking one **replaces** the previous attempt entirely —
   there's one permanent record per chapter, not a growing pile of old
   attempts. No camera during quizzes.

3. **Admin creates mids** whenever they want, picking exactly which
   chapters it covers. Same auto-grading as quizzes. **Camera is on.**

4. Once a student has **passed every chapter's quiz**, the **final
   unlocks**. One-shot — can't retake it normally. May include essay
   questions, so a **teacher grades it manually**, and can regrade later
   if there's an appeal. **Camera is on.**

5. **The whole time an exam has a camera on** (mid/final only), the system
   watches for: face missing, multiple faces, tab switching, leaving
   fullscreen, copy/paste, devtools open. Quizzes only watch tab
   switching/fullscreen/copy-paste/devtools — no camera.

6. **Everything is scored automatically**, and a total "suspicion score"
   builds up during the exam. If it crosses the threshold, the system
   **quietly marks the exam as invalidated in the background** — but the
   student is not interrupted and keeps taking the exam normally. A
   notification (email or however you choose) goes out separately after
   the fact, with the score and the reasons why.

7. **The only way back** is the student emailing the admin directly
   (outside the app). If the admin agrees it was a mistake, they manually
   flip a switch in the system that clears the flag — logged, one entry
   per case.

---

## Why some things are scored the way they are

- **A 3-second camera glitch ≠ someone walking away for 2 minutes.**
  So face/multiple-face detection is scored by **how long** the problem
  lasted, not by how many times a check happened to catch it.
- **Tab-switching 10 times in one second is one accidental click, not 10
  separate offenses.** So rapid repeats of the same action collapse into
  one logged event instead of spamming the score.
- **Copy/paste that matches the exact question text is a stronger signal**
  than a random paste — that gets flagged with extra detail for whoever
  reviews an appeal later, even though it's not scored differently yet.

---

## What's new since the first draft (added on top of the original schema)

- **Enrollment** — a gate that has to exist before a student can take
  anything.
- **Admin-controlled mids** — admin explicitly picks the chapters, not a
  range, not the student.
- **Manual grading + regrades for finals only** — quizzes/mids stay fully
  automatic.
- **Full automation of cheating consequences** — no human review by
  default; the system decides and acts on its own.
- **Appeals** — the one manual override path, only triggered by a
  real-world email, logged when it happens.
- **Camera restricted to mid/final** — quizzes were never meant to be
  camera-monitored.
- **Duration-based scoring for camera events** — replacing flat "it
  happened, add points" with "how long did it last."
- **Book → curriculum generation** — a curriculum isn't typed in by hand
  anymore; it's generated from an uploaded book (dummy version now, real
  AI pipeline later), and can be personalized per student rather than one
  curriculum shared by everyone.
- **Questions generated fresh every time, never stored in a bank** — a
  quiz/mid/final's questions are created the moment a student starts (or
  retakes) it, stored on that one permanent exam record, and replaced
  entirely on the next retake — so there's no growing pile of old
  question sets to manage.

---

## What's intentionally NOT built yet (future work)

- Students requesting their own custom practice quizzes across chapters
  they pick themselves.

That's the whole shape of it. Everything else in `schema-design.md` is just
the technical detail underneath these seven steps.

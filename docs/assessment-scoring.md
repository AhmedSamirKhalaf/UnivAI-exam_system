# Assessment option and scoring contract

- Weekly quiz MCQs have exactly 4 unique options.
- Midterm and final MCQs have exactly 6 unique options.
- A correct MCQ answer adds 1 point.
- A non-blank wrong MCQ answer subtracts 1 point.
- A blank, skipped, or omitted MCQ answer adds 0 points.
- The total mark is `max(0, correct - wrong)`; it can never be negative.
- For an auto-graded objective paper, `max_score` remains the total question
  count, so result callbacks keep the same denominator and transcript
  percentages remain correct.
- Integrity invalidation is separate from arithmetic: an invalidated attempt
  keeps its calculated mark for review but cannot pass.

Option-count validation applies to newly published packages. The scorer remains
compatible with already-persisted assessments that used an older option count.
When an unpublished legacy four-choice bank must seed a midterm or final, the
compatibility adapter adds two deterministic aggregate distractors; it never
rewrites an already-started or submitted paper.

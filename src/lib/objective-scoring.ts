export interface ObjectiveQuestion {
  question_id?: unknown;
  type?: unknown;
  correct_option?: unknown;
}

export interface ObjectiveAnswer {
  question_id?: unknown;
  answer?: unknown;
}

export interface ObjectiveScore {
  mark: number;
  maxScore: number;
  correct: number;
  incorrect: number;
  blank: number;
}

function optionLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const match = /^([A-Z])(?:[).:]|\s|$)/i.exec(trimmed);
  return match?.[1].toUpperCase() ?? null;
}

function isCorrectObjectiveAnswer(response: string, correctOption: unknown): boolean {
  if (typeof correctOption !== "string") return false;
  const submitted = response.trim();
  const correct = correctOption.trim();
  if (submitted === correct) return true;
  const submittedLabel = optionLabel(submitted);
  const correctLabel = optionLabel(correct);
  return submittedLabel !== null && correctLabel !== null && submittedLabel === correctLabel;
}

/**
 * American-style MCQ scoring used by every automatic grading path:
 * correct +1, incorrect -1, blank/omitted 0, with the paper total floored at 0.
 *
 * The function accepts old papers with any option count so changing the
 * publication contract never makes an already-started attempt ungradeable.
 */
export function scoreObjectiveAnswers(
  questions: ObjectiveQuestion[],
  studentAnswers: ObjectiveAnswer[],
): ObjectiveScore {
  const questionsById = new Map<string, ObjectiveQuestion>();
  for (const question of questions) {
    if (typeof question.question_id !== "string" || !question.question_id.trim()) {
      throw new Error("Objective question is missing a valid question_id");
    }
    if (questionsById.has(question.question_id)) {
      throw new Error("Objective questions contain duplicate question IDs");
    }
    questionsById.set(question.question_id, question);
  }

  const answersById = new Map<string, unknown>();
  for (const answer of studentAnswers) {
    if (typeof answer.question_id !== "string" || !answer.question_id.trim()) {
      throw new Error("Student answer is missing a valid question_id");
    }
    if (!questionsById.has(answer.question_id)) {
      throw new Error(`Student answer references unknown question "${answer.question_id}"`);
    }
    if (answersById.has(answer.question_id)) {
      throw new Error("Student answers contain duplicate question IDs");
    }
    answersById.set(answer.question_id, answer.answer);
  }

  let correct = 0;
  let incorrect = 0;
  let blank = 0;

  for (const question of questions) {
    if (question.type !== "mcq") continue;

    const questionId = question.question_id as string;
    const response = answersById.get(questionId);
    if (response === undefined || response === null || response === "") {
      blank += 1;
      continue;
    }
    if (typeof response !== "string") {
      throw new Error(`Student answer for question "${questionId}" must be text`);
    }
    if (!response.trim()) {
      blank += 1;
      continue;
    }

    if (isCorrectObjectiveAnswer(response, question.correct_option)) correct += 1;
    else incorrect += 1;
  }

  return {
    mark: Math.max(0, correct - incorrect),
    maxScore: correct + incorrect + blank,
    correct,
    incorrect,
    blank,
  };
}

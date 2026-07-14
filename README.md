# Exam System

A Next.js exam platform where users answer questions one at a time with sidebar navigation. Built with the App Router and the Next.js Route Handlers for API endpoints.

## Project Structure

```
app/
  layout.tsx          - Root layout (html, body, metadata)
  page.tsx            - Warning/start page with exam rules
  globals.css         - All styles
  components/
    QuestionCard.tsx  - Renders a single MCQ question with radio buttons
    QuestionList.tsx  - Sidebar list showing seen questions with answer status
  exam/
    page.tsx          - Exam page: fetches questions, manages navigation & state
  result/
    page.tsx          - Result page: submits answers, displays grade & breakdown
  data/
    questions.ts      - Dummy question data (10 MCQ questions)
  api/
    questions/
      route.ts        - GET: returns questions without answers
    end-exam/
      route.ts        - POST: receives answers, returns grade & per-question results
```

## Pages

| Route       | Description                                      |
|-------------|--------------------------------------------------|
| `/`         | Exam rules warning page with a "Start Exam" button |
| `/exam`     | Exam page with question card and sidebar list    |
| `/result`   | Shows grade, correct count, and per-question breakdown |

## API Endpoints

### `GET /api/questions`

Returns all questions **without** correct answers.

**Response:**
```json
[
  {
    "id": "q1",
    "text": "What does HTML stand for?",
    "options": [
      { "label": "Hyper Text Markup Language", "value": "a" },
      ...
    ]
  },
  ...
]
```

### `POST /api/end-exam`

Receives user answers and returns the graded result.

**Request:**
```json
{ "answers": { "q1": "a", "q2": "b", ... } }
```

**Response:**
```json
{
  "grade": 70,
  "correct": 7,
  "total": 10,
  "results": [
    { "id": "q1", "text": "...", "correctAnswer": "a", "userAnswer": "a", "isCorrect": true },
    ...
  ]
}
```

## How It Works

1. User lands on `/`, reads the exam rules, and clicks **Start Exam**.
2. `/exam` fetches questions from `GET /api/questions`. Only question 1 is shown initially.
3. **Next** advances to the next question and adds it to the sidebar. **Previous** goes back.
4. Clicking a question in the sidebar jumps directly to it. Answered questions show a checkmark.
5. **End Exam** stores answers in `sessionStorage`, navigates to `/result`.
6. `/result` sends answers to `POST /api/end-exam`, displays the grade and a per-question breakdown.

## Running

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

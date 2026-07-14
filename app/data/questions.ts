export interface Question {
  id: string;
  text: string;
  options: { label: string; value: string }[];
}

export interface QuestionWithAnswer extends Question {
  correctAnswer: string;
}

export const questions: QuestionWithAnswer[] = [
  {
    id: "q1",
    text: "What does HTML stand for?",
    options: [
      { label: "Hyper Text Markup Language", value: "a" },
      { label: "High Tech Modern Language", value: "b" },
      { label: "Hyper Transfer Markup Language", value: "c" },
      { label: "None of the above", value: "d" },
    ],
    correctAnswer: "a",
  },
  {
    id: "q2",
    text: "Which method is used to parse JSON in JavaScript?",
    options: [
      { label: "JSON.parse()", value: "a" },
      { label: "JSON.stringify()", value: "b" },
      { label: "JSON.convert()", value: "c" },
      { label: "JSON.toObject()", value: "d" },
    ],
    correctAnswer: "a",
  },
  {
    id: "q3",
    text: "What does CSS stand for?",
    options: [
      { label: "Computer Style Sheets", value: "a" },
      { label: "Cascading Style Sheets", value: "b" },
      { label: "Creative Style System", value: "c" },
      { label: "Colorful Style Sheets", value: "d" },
    ],
    correctAnswer: "b",
  },
  {
    id: "q4",
    text: "Which keyword is used to declare a block-scoped variable in JavaScript?",
    options: [
      { label: "var", value: "a" },
      { label: "let", value: "b" },
      { label: "define", value: "c" },
      { label: "dim", value: "d" },
    ],
    correctAnswer: "b",
  },
  {
    id: "q5",
    text: "What is the output of typeof null in JavaScript?",
    options: [
      { label: '"null"', value: "a" },
      { label: '"undefined"', value: "b" },
      { label: '"object"', value: "c" },
      { label: '"boolean"', value: "d" },
    ],
    correctAnswer: "c",
  },
  {
    id: "q6",
    text: "Which HTTP method is used to submit form data that modifies state?",
    options: [
      { label: "GET", value: "a" },
      { label: "POST", value: "b" },
      { label: "HEAD", value: "c" },
      { label: "OPTIONS", value: "d" },
    ],
    correctAnswer: "b",
  },
  {
    id: "q7",
    text: "What does the acronym API stand for?",
    options: [
      { label: "Application Programming Interface", value: "a" },
      { label: "Advanced Process Integration", value: "b" },
      { label: "Automated Program Invocation", value: "c" },
      { label: "Application Protocol Interface", value: "d" },
    ],
    correctAnswer: "a",
  },
  {
    id: "q8",
    text: "Which data structure uses FIFO (First In, First Out)?",
    options: [
      { label: "Stack", value: "a" },
      { label: "Queue", value: "b" },
      { label: "Tree", value: "c" },
      { label: "Graph", value: "d" },
    ],
    correctAnswer: "b",
  },
  {
    id: "q9",
    text: "What is the default port number for HTTP?",
    options: [
      { label: "21", value: "a" },
      { label: "443", value: "b" },
      { label: "80", value: "c" },
      { label: "8080", value: "d" },
    ],
    correctAnswer: "c",
  },
  {
    id: "q10",
    text: "Which of the following is NOT a JavaScript framework/library?",
    options: [
      { label: "React", value: "a" },
      { label: "Angular", value: "b" },
      { label: "Django", value: "c" },
      { label: "Vue", value: "d" },
    ],
    correctAnswer: "c",
  },
];

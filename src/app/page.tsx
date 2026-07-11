"use client";

import React, { useState, useEffect, useRef } from "react";

// ==========================================
// C++ Question Pool (15 Questions)
// ==========================================
const CPP_QUESTION_POOL = [
  {
    id: "cpp_1",
    prompt: "What is the output of the following code?\n\n#include <iostream>\nusing namespace std;\nint main() {\n    int a = 5;\n    int &b = a;\n    b = 10;\n    cout << a;\n    return 0;\n}",
    options: ["5", "10", "Compiler Error", "Runtime Error"],
    correctAnswer: "B" // 10 is index 1 -> B
  },
  {
    id: "cpp_2",
    prompt: "Which of the following constructors is called when an object is initialized with another object of the same class type?",
    options: ["Default constructor", "Parameterized constructor", "Copy constructor", "Conversion constructor"],
    correctAnswer: "C"
  },
  {
    id: "cpp_3",
    prompt: "What does the keyword 'virtual' do when applied to a class member function?",
    options: [
      "It prevents derived classes from overriding the function",
      "It allows dynamic (run-time) binding for overridden functions",
      "It optimizes memory usage by allocating it static storage",
      "It declares the function as inline automatically"
    ],
    correctAnswer: "B"
  },
  {
    id: "cpp_4",
    prompt: "What is the correct syntax for declaring a pure virtual function in C++?",
    options: [
      "virtual void func() = 0;",
      "virtual void func() = pure;",
      "pure virtual void func();",
      "virtual void func() {};"
    ],
    correctAnswer: "A"
  },
  {
    id: "cpp_5",
    prompt: "What is the primary difference between a class and a struct in C++?",
    options: [
      "Structs cannot have member functions",
      "Classes cannot be inherited, while structs can",
      "Members of a class are private by default; members of a struct are public by default",
      "Structs cannot use templates"
    ],
    correctAnswer: "C"
  },
  {
    id: "cpp_6",
    prompt: "What will happen if you attempt to dynamically allocate memory using 'new' but the system runs out of memory?",
    options: [
      "It returns a null pointer (nullptr)",
      "It throws a std::bad_alloc exception",
      "The program terminates immediately with exit code 0",
      "The operating system automatically allocates disk swap space"
    ],
    correctAnswer: "B"
  },
  {
    id: "cpp_7",
    prompt: "Which C++ standard library smart pointer is designed for non-owning references to objects managed by std::shared_ptr?",
    options: ["std::unique_ptr", "std::weak_ptr", "std::auto_ptr", "std::ref_ptr"],
    correctAnswer: "B"
  },
  {
    id: "cpp_8",
    prompt: "What does RAII (Resource Acquisition Is Initialization) mean in C++?",
    options: [
      "Resources should only be acquired inside main()",
      "Resource lifetime is tied to object lifetime (constructor/destructor)",
      "Memory is garbage collected automatically when initialized",
      "Variables must be declared and initialized in the same line"
    ],
    correctAnswer: "B"
  },
  {
    id: "cpp_9",
    prompt: "Which type cast in C++ is used to perform downcasting in an inheritance hierarchy with polymorphic classes, and performs runtime checks?",
    options: ["static_cast", "dynamic_cast", "reinterpret_cast", "const_cast"],
    correctAnswer: "B"
  },
  {
    id: "cpp_10",
    prompt: "What does the 'const' keyword after a class member function declaration signify? E.g., 'void display() const;'",
    options: [
      "The function return value cannot be modified",
      "The function cannot modify any non-static member variables of the class",
      "The function can only be called from const main()",
      "The function execution speed is optimized by the compiler"
    ],
    correctAnswer: "B"
  },
  {
    id: "cpp_11",
    prompt: "Which of the following correctly describes 'std::move' in C++11?",
    options: [
      "It physically moves binary data from one memory location to another",
      "It converts its argument to an rvalue reference, enabling move semantics",
      "It releases the memory of the object and sets it to nullptr",
      "It is used to move file cursors in std::fstream"
    ],
    correctAnswer: "B"
  },
  {
    id: "cpp_12",
    prompt: "What is the purpose of 'template <typename T>' in C++?",
    options: [
      "To create a template for compiler warning reporting",
      "To define generic classes or functions that work with any data type",
      "To create system environment variables dynamically",
      "To enforce type safety checks in dynamic casts"
    ],
    correctAnswer: "B"
  },
  {
    id: "cpp_13",
    prompt: "What is a 'friend function' in C++?",
    options: [
      "A global function that has access to public members of a class",
      "A member function of a class that can access private members of another class",
      "A non-member function that is granted access to the private and protected members of a class",
      "A function that cannot be inherited by subclasses"
    ],
    correctAnswer: "C"
  },
  {
    id: "cpp_14",
    prompt: "Which of the following is the correct destructor signature for class 'Widget'?",
    options: ["void ~Widget()", "~Widget(int x)", "~Widget()", "delete Widget()"],
    correctAnswer: "C"
  },
  {
    id: "cpp_15",
    prompt: "What is the output of 'cout << (10 >> 1);' in C++?",
    options: ["10", "5", "20", "9"],
    correctAnswer: "B"
  }
];

interface ProctoringEvent {
  id: string;
  type: string;
  weight: number;
  timestamp: Date;
  label: string;
  detail: string;
  duration?: number;
}

export default function Home() {
  // Navigation / Step State
  const [step, setStep] = useState<"welcome" | "exam" | "result">("welcome");
  
  // Student Information
  const [studentName, setStudentName] = useState("");
  
  // Exam Content State
  const [questions, setQuestions] = useState<typeof CPP_QUESTION_POOL>([]);
  const [currentQuestionIdx, setCurrentQuestionIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({}); // { questionIndex: SelectedOption }
  
  // Proctoring Integrity State
  const [suspicionScore, setSuspicionScore] = useState(0);
  const [events, setEvents] = useState<ProctoringEvent[]>([]);
  
  // Timer State
  const [timeLeft, setTimeLeft] = useState(900); // 15:00 minutes
  const [elapsedTime, setElapsedTime] = useState(0);
  
  // Webcam State
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  
  // Camera simulation triggers
  const [noFaceActive, setNoFaceActive] = useState(false);
  const [multipleFacesActive, setMultipleFacesActive] = useState(false);
  const noFaceIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const multipleFacesIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Fullscreen helper states
  const [isFullscreen, setIsFullscreen] = useState(false);

  // ==========================================
  // Event logger
  // ==========================================
  const addProctoringEvent = (type: string, label: string, detail: string, weight: number) => {
    const newEvent: ProctoringEvent = {
      id: Math.random().toString(36).substring(2, 9),
      type,
      label,
      detail,
      weight,
      timestamp: new Date()
    };
    setEvents(prev => [newEvent, ...prev]);
    setSuspicionScore(prev => Math.min(100, prev + weight));
  };

  // ==========================================
  // Fullscreen Handlers
  // ==========================================
  const requestFullscreen = async () => {
    try {
      const docEl = document.documentElement;
      if (docEl.requestFullscreen) {
        await docEl.requestFullscreen();
      }
    } catch (err) {
      console.warn("Fullscreen request rejected", err);
    }
  };

  useEffect(() => {
    if (step !== "exam") return;

    const handleFullscreenChange = () => {
      const isFull = !!document.fullscreenElement;
      setIsFullscreen(isFull);
      if (!isFull) {
        addProctoringEvent(
          "fullscreen_exit",
          "Fullscreen Exit",
          "Student exited fullscreen mode.",
          30
        );
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, [step]);

  // ==========================================
  // Tab Switch (Blur/Focus) Handlers
  // ==========================================
  useEffect(() => {
    if (step !== "exam") return;

    const handleBlur = () => {
      addProctoringEvent(
        "tab_switch",
        "Tab Focus Lost",
        "Student navigated away from the exam tab.",
        25
      );
    };

    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("blur", handleBlur);
    };
  }, [step]);

  // ==========================================
  // DevTools Detect (Simple window resize proxy)
  // ==========================================
  useEffect(() => {
    if (step !== "exam") return;

    const handleResize = () => {
      // Threshold check: Significant layout shift could mean DevTools opened
      const threshold = 150;
      if (window.outerWidth - window.innerWidth > threshold || window.outerHeight - window.innerHeight > threshold) {
        addProctoringEvent(
          "devtools_open",
          "Developer Tools Check",
          "Possible developer console opening detected via window resize.",
          35
        );
      }
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [step]);

  // ==========================================
  // Copy / Paste Handlers
  // ==========================================
  useEffect(() => {
    if (step !== "exam") return;

    const handleCopy = (e: ClipboardEvent) => {
      e.preventDefault();
      addProctoringEvent(
        "copy_paste",
        "Copy Action",
        "Student attempted to copy text from the exam page.",
        20
      );
    };

    const handlePaste = (e: ClipboardEvent) => {
      e.preventDefault();
      addProctoringEvent(
        "copy_paste",
        "Paste Action",
        "Student attempted to paste text into the exam page.",
        20
      );
    };

    document.addEventListener("copy", handleCopy);
    document.addEventListener("paste", handlePaste);
    return () => {
      document.removeEventListener("copy", handleCopy);
      document.removeEventListener("paste", handlePaste);
    };
  }, [step]);

  // ==========================================
  // Webcam stream activation
  // ==========================================
  const startWebcam = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 240 }
      });
      setCameraStream(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setCameraError(false);
    } catch (err) {
      console.warn("Unable to capture video device", err);
      setCameraError(true);
    }
  };

  const stopWebcam = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
  };

  useEffect(() => {
    if (step === "exam") {
      startWebcam();
    } else {
      stopWebcam();
    }
    return () => stopWebcam();
  }, [step]);

  // ==========================================
  // Active Camera Simulations
  // ==========================================
  useEffect(() => {
    if (noFaceActive) {
      // Accumulate score every 3 seconds to match the backend camera check interval
      noFaceIntervalRef.current = setInterval(() => {
        addProctoringEvent(
          "no_face",
          "Face Absent",
          "Camera Check: No student face detected in webcam view.",
          15
        );
      }, 3000);
    } else {
      if (noFaceIntervalRef.current) {
        clearInterval(noFaceIntervalRef.current);
      }
    }

    return () => {
      if (noFaceIntervalRef.current) clearInterval(noFaceIntervalRef.current);
    };
  }, [noFaceActive]);

  useEffect(() => {
    if (multipleFacesActive) {
      multipleFacesIntervalRef.current = setInterval(() => {
        addProctoringEvent(
          "multiple_faces",
          "Multiple Faces",
          "Camera Check: Multiple faces detected in camera scene.",
          25
        );
      }, 3000);
    } else {
      if (multipleFacesIntervalRef.current) {
        clearInterval(multipleFacesIntervalRef.current);
      }
    }

    return () => {
      if (multipleFacesIntervalRef.current) clearInterval(multipleFacesIntervalRef.current);
    };
  }, [multipleFacesActive]);

  // ==========================================
  // Exam Timer
  // ==========================================
  useEffect(() => {
    if (step !== "exam") return;

    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          finishExam();
          return 0;
        }
        return prev - 1;
      });
      setElapsedTime(prev => prev + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [step]);

  // ==========================================
  // Exam Navigation & Operations
  // ==========================================
  const startExam = () => {
    if (!studentName.trim()) {
      alert("Please enter your name to start the exam.");
      return;
    }
    // Select 10 random questions from pool
    const shuffled = [...CPP_QUESTION_POOL].sort(() => 0.5 - Math.random());
    setQuestions(shuffled.slice(0, 10));
    setAnswers({});
    setCurrentQuestionIdx(0);
    setSuspicionScore(0);
    setEvents([]);
    setTimeLeft(900);
    setElapsedTime(0);
    setStep("exam");
    requestFullscreen();
  };

  const finishExam = () => {
    setNoFaceActive(false);
    setMultipleFacesActive(false);
    
    // Exit fullscreen
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    
    setStep("result");
  };

  const calculateScore = () => {
    let score = 0;
    questions.forEach((q, idx) => {
      const ansChar = answers[idx]; // E.g. "A", "B", "C", "D"
      if (ansChar) {
        const optionIndex = ansChar.charCodeAt(0) - 65; // 'A' -> 0, 'B' -> 1
        if (q.options[optionIndex] === q.options["ABCD".indexOf(q.correctAnswer)]) {
          score++;
        }
      }
    });
    return score;
  };

  const score = calculateScore();
  const passed = score >= 6;
  const isInvalidated = suspicionScore >= 50;

  // Format Timer output
  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remainingSecs = secs % 60;
    return `${mins.toString().padStart(2, "0")}:${remainingSecs.toString().padStart(2, "0")}`;
  };

  // Generate and download report
  const downloadReport = () => {
    const reportData = {
      examType: "C++ Programming Assessment",
      studentName,
      date: new Date().toLocaleDateString(),
      elapsedTime: `${Math.floor(elapsedTime / 60)}m ${elapsedTime % 60}s`,
      score: `${score} / 10`,
      percentage: `${(score / 10) * 100}%`,
      outcome: passed ? "PASSED" : "FAILED",
      integrityStatus: isInvalidated ? "INVALIDATED" : "CLEAN",
      suspicionScore: `${suspicionScore} / 100`,
      questions: questions.map((q, idx) => ({
        index: idx + 1,
        question: q.prompt,
        yourAnswer: answers[idx] || "Unanswered",
        correctAnswer: q.correctAnswer
      })),
      proctoringLogs: events.map(e => ({
        type: e.type,
        label: e.label,
        detail: e.detail,
        suspicionAdded: e.weight,
        time: e.timestamp.toLocaleTimeString()
      }))
    };

    const blob = new Blob([JSON.stringify(reportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ProctorReport_${studentName.replace(/\s+/g, "_")}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-500 selection:text-white">
      {/* ==========================================
          HEADER BAR
          ========================================== */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md px-6 py-4 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/20 font-bold text-white text-lg tracking-wider">
            C++
          </div>
          <div>
            <h1 className="font-semibold text-slate-100 tracking-tight">Proctored Exam Platform</h1>
            <p className="text-xs text-slate-400">Automated Integrity Monitor</p>
          </div>
        </div>

        {step === "exam" && (
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2 bg-slate-800/80 px-3 py-1.5 rounded-md border border-slate-700 text-sm">
              <span className="w-2 h-2 rounded-full bg-indigo-500 animate-ping"></span>
              <span className="text-slate-400">Time Remaining:</span>
              <span className="font-mono font-bold text-indigo-400">{formatTime(timeLeft)}</span>
            </div>
            <div className="text-right text-xs">
              <div className="text-slate-400">Student:</div>
              <div className="font-medium text-slate-200">{studentName}</div>
            </div>
          </div>
        )}
      </header>

      {/* ==========================================
          WELCOME SCREEN
          ========================================== */}
      {step === "welcome" && (
        <main className="flex-1 flex items-center justify-center p-6 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-black">
          <div className="w-full max-w-lg bg-slate-900/70 border border-slate-800/80 p-8 rounded-2xl shadow-2xl backdrop-blur-xl relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500"></div>
            
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold tracking-tight text-white mb-2">C++ Programming Exam</h2>
              <p className="text-slate-400 text-sm">Enter your name and review the security checklist to start.</p>
            </div>

            <div className="space-y-6">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Full Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Alice Smith"
                  value={studentName}
                  onChange={(e) => setStudentName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                />
              </div>

              <div className="bg-slate-950/60 border border-slate-800/60 rounded-xl p-4 space-y-3">
                <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  Proctoring Checklist
                </h3>
                <div className="space-y-2 text-sm text-slate-400">
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                    <span>Webcam Permission Requested</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                    <span>Enforced Fullscreen Environment</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                    <span>Anti-Copy / Paste System Active</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                    <span>Tab focus monitoring enabled</span>
                  </div>
                </div>
              </div>

              <button
                onClick={startExam}
                className="w-full bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 active:from-indigo-700 active:to-indigo-800 text-white font-medium py-3 rounded-xl shadow-lg shadow-indigo-500/10 hover:shadow-indigo-500/25 transition-all flex items-center justify-center gap-2 group cursor-pointer"
              >
                <span>Begin Examination</span>
                <svg className="w-4 h-4 transform group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
        </main>
      )}

      {/* ==========================================
          EXAM TAKING SCREEN
          ========================================== */}
      {step === "exam" && (
        <main className="flex-1 flex flex-col lg:flex-row bg-slate-950 p-6 gap-6 relative overflow-hidden">
          {/* LEFT COLUMN: Webcam & Proctoring Anomaly Simulator */}
          <section className="w-full lg:w-80 flex flex-col gap-6 shrink-0">
            {/* Camera feed */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 flex flex-col items-center relative overflow-hidden">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider self-start mb-3">
                Live Proctoring Feed
              </h3>
              
              <div className="w-full aspect-video bg-black rounded-lg overflow-hidden relative border border-slate-800 flex items-center justify-center">
                {cameraError ? (
                  <div className="text-center p-3 text-slate-500">
                    <svg className="w-8 h-8 mx-auto mb-1 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                    </svg>
                    <span className="text-xs block">Camera Access Blocked</span>
                  </div>
                ) : (
                  <>
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-full object-cover scale-x-[-1]"
                    />
                    {/* Simulated indicators */}
                    {(noFaceActive || multipleFacesActive) && (
                      <div className="absolute inset-0 bg-red-600/10 flex items-center justify-center backdrop-blur-2xs">
                        <span className="bg-red-600 text-white font-bold text-xs uppercase tracking-wide px-2.5 py-1 rounded shadow-lg animate-pulse">
                          {noFaceActive ? "Face Absent" : "Multiple Faces"}
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>
              
              <div className="w-full flex items-center justify-between mt-3 text-xs">
                <span className="text-slate-500">Webcam Monitor:</span>
                <span className="text-emerald-500 font-medium flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                  Active
                </span>
              </div>
            </div>

            {/* Proctoring Simulator Console */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 flex flex-col gap-4">
              <div>
                <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                  Anomaly Simulator
                </h3>
                <p className="text-[11px] text-slate-500 leading-snug">
                  Click buttons to manually trigger proctoring violations and test the silent background invalidation.
                </p>
              </div>

              {/* Suspicion Score Gauge */}
              <div className="bg-slate-950/80 border border-slate-800/80 rounded-xl p-3.5 flex flex-col gap-2.5">
                <div className="flex items-center justify-between text-xs font-medium">
                  <span className="text-slate-400">Suspicion Score</span>
                  <span className={`font-mono font-bold text-sm ${
                    suspicionScore >= 50 ? "text-rose-500" : suspicionScore >= 25 ? "text-amber-500" : "text-indigo-400"
                  }`}>
                    {suspicionScore} / 100
                  </span>
                </div>
                
                {/* Progress bar */}
                <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 rounded-full ${
                      suspicionScore >= 50 ? "bg-rose-500 shadow-md shadow-rose-500/20" : suspicionScore >= 25 ? "bg-amber-500" : "bg-indigo-500"
                    }`}
                    style={{ width: `${suspicionScore}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-[10px] text-slate-500 font-medium">
                  <span>Threshold: 50</span>
                  <span>
                    Status:{" "}
                    <span className={suspicionScore >= 50 ? "text-rose-500 font-bold" : "text-emerald-500"}>
                      {suspicionScore >= 50 ? "INVALIDATED" : "CLEAN"}
                    </span>
                  </span>
                </div>
              </div>

              {/* Simulation Buttons Grid */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                {/* Camera triggers */}
                <button
                  onClick={() => setNoFaceActive(prev => !prev)}
                  className={`p-2 rounded-lg border text-left font-medium transition-all cursor-pointer ${
                    noFaceActive
                      ? "bg-rose-600/20 border-rose-500 text-rose-300 ring-1 ring-rose-500/20"
                      : "bg-slate-950 border-slate-800 hover:border-slate-700 text-slate-300"
                  }`}
                >
                  <div className="font-bold text-[10px] uppercase text-slate-400 mb-0.5">Camera</div>
                  {noFaceActive ? "Stop No Face" : "No Face (15pts)"}
                </button>

                <button
                  onClick={() => setMultipleFacesActive(prev => !prev)}
                  className={`p-2 rounded-lg border text-left font-medium transition-all cursor-pointer ${
                    multipleFacesActive
                      ? "bg-rose-600/20 border-rose-500 text-rose-300 ring-1 ring-rose-500/20"
                      : "bg-slate-950 border-slate-800 hover:border-slate-700 text-slate-300"
                  }`}
                >
                  <div className="font-bold text-[10px] uppercase text-slate-400 mb-0.5">Camera</div>
                  {multipleFacesActive ? "Stop Multi Face" : "Multi Face (25)"}
                </button>

                {/* Discrete triggers */}
                <button
                  onClick={() => addProctoringEvent("tab_switch", "Tab Switch", "Student switched browser tabs.", 25)}
                  className="p-2 bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-lg text-left text-slate-300 font-medium transition-colors cursor-pointer"
                >
                  <div className="font-bold text-[10px] uppercase text-slate-400 mb-0.5">Tab</div>
                  Tab Switch (25)
                </button>

                <button
                  onClick={() => addProctoringEvent("fullscreen_exit", "Fullscreen Exit", "Student left fullscreen view.", 30)}
                  className="p-2 bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-lg text-left text-slate-300 font-medium transition-colors cursor-pointer"
                >
                  <div className="font-bold text-[10px] uppercase text-slate-400 mb-0.5">Screen</div>
                  Exit Full (30)
                </button>

                <button
                  onClick={() => addProctoringEvent("devtools_open", "DevTools Detect", "Developer console toggle simulated.", 35)}
                  className="p-2 bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-lg text-left text-slate-300 font-medium transition-colors cursor-pointer"
                >
                  <div className="font-bold text-[10px] uppercase text-slate-400 mb-0.5">Console</div>
                  DevTools (35)
                </button>

                <button
                  onClick={() => addProctoringEvent("copy_paste", "Copy / Paste", "Clipboard interaction captured.", 20)}
                  className="p-2 bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-lg text-left text-slate-300 font-medium transition-colors cursor-pointer"
                >
                  <div className="font-bold text-[10px] uppercase text-slate-400 mb-0.5">Clipboard</div>
                  Copy Paste (20)
                </button>
              </div>
            </div>
          </section>

          {/* CENTER COLUMN: Active C++ Exam Questions */}
          <section className="flex-1 flex flex-col gap-6">
            {/* Question Card */}
            {questions.length > 0 && (
              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 flex-1 flex flex-col relative overflow-hidden">
                {/* Question index header */}
                <div className="flex items-center justify-between mb-4">
                  <span className="text-xs font-semibold text-indigo-400 uppercase tracking-widest">
                    Question {currentQuestionIdx + 1} of 10
                  </span>
                  <span className="text-xs text-slate-500">MCQ Format</span>
                </div>

                {/* Progress bar */}
                <div className="w-full h-1 bg-slate-850 rounded-full mb-6 overflow-hidden">
                  <div
                    className="h-full bg-indigo-500 rounded-full transition-all duration-300"
                    style={{ width: `${((currentQuestionIdx + 1) / 10) * 100}%` }}
                  />
                </div>

                {/* Question text & code snippet */}
                <div className="flex-1 flex flex-col gap-6">
                  <div className="text-base text-slate-100 font-medium leading-relaxed whitespace-pre-line">
                    {questions[currentQuestionIdx].prompt}
                  </div>

                  {/* Options */}
                  <div className="space-y-3">
                    {questions[currentQuestionIdx].options.map((option, oIdx) => {
                      const letter = String.fromCharCode(65 + oIdx); // 'A', 'B', etc.
                      const isSelected = answers[currentQuestionIdx] === letter;

                      return (
                        <button
                          key={letter}
                          onClick={() => setAnswers(prev => ({ ...prev, [currentQuestionIdx]: letter }))}
                          className={`w-full text-left px-5 py-4 rounded-xl border text-sm font-medium transition-all flex items-center justify-between group cursor-pointer ${
                            isSelected
                              ? "bg-indigo-600/10 border-indigo-500 text-indigo-300 ring-1 ring-indigo-500/20"
                              : "bg-slate-950/60 border-slate-850 hover:border-slate-800 text-slate-300"
                          }`}
                        >
                          <span className="flex items-center gap-3">
                            <span className={`w-6 h-6 rounded-md flex items-center justify-center font-bold text-xs ${
                              isSelected
                                ? "bg-indigo-600 text-white"
                                : "bg-slate-900 border border-slate-800 text-slate-400 group-hover:text-slate-200 group-hover:border-slate-700"
                            }`}>
                              {letter}
                            </span>
                            <span>{option}</span>
                          </span>
                          
                          {isSelected && (
                            <svg className="w-4 h-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Footer Controls */}
                <div className="flex items-center justify-between mt-8 pt-6 border-t border-slate-800/80">
                  <button
                    disabled={currentQuestionIdx === 0}
                    onClick={() => setCurrentQuestionIdx(prev => prev - 1)}
                    className="px-5 py-2.5 bg-slate-950 border border-slate-850 hover:border-slate-800 disabled:opacity-40 disabled:pointer-events-none rounded-xl text-sm font-semibold text-slate-300 transition-colors flex items-center gap-2 cursor-pointer"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                    Previous
                  </button>

                  {currentQuestionIdx < 9 ? (
                    <button
                      onClick={() => setCurrentQuestionIdx(prev => prev + 1)}
                      className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white rounded-xl text-sm font-semibold transition-colors flex items-center gap-2 cursor-pointer"
                    >
                      Next
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  ) : (
                    <button
                      onClick={finishExam}
                      className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white rounded-xl text-sm font-bold shadow-lg shadow-emerald-600/10 hover:shadow-emerald-600/20 transition-colors cursor-pointer"
                    >
                      Finish Exam
                    </button>
                  )}
                </div>
              </div>
            )}
          </section>

          {/* RIGHT COLUMN: Realtime Log of Proctoring Events */}
          <section className="w-full lg:w-80 bg-slate-900/60 border border-slate-800 rounded-2xl p-4 shrink-0 flex flex-col h-[500px] lg:h-auto">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
              Real-Time Security Log
            </h3>
            
            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1.5 scrollbar-thin scrollbar-thumb-slate-800">
              {events.length === 0 ? (
                <div className="h-full flex items-center justify-center text-slate-600 text-xs text-center p-4">
                  No anomalies detected. Exam integrity level optimal.
                </div>
              ) : (
                events.map((e) => (
                  <div
                    key={e.id}
                    className="p-3 bg-slate-950 border border-slate-850 rounded-xl space-y-1.5 text-xs transition-all hover:border-slate-800 animate-slide-up"
                  >
                    <div className="flex items-center justify-between font-semibold">
                      <span className="text-rose-400 flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                        {e.label}
                      </span>
                      <span className="text-slate-500 font-mono text-[10px]">
                        +{e.weight}pts
                      </span>
                    </div>
                    <p className="text-slate-400 leading-snug">{e.detail}</p>
                    <div className="text-[10px] text-slate-600 text-right">
                      {e.timestamp.toLocaleTimeString()}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </main>
      )}

      {/* ==========================================
          GRADE / RESULT SCREEN
          ========================================== */}
      {step === "result" && (
        <main className="flex-1 p-6 flex items-center justify-center bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-black">
          <div className="w-full max-w-2xl bg-slate-900/70 border border-slate-800/80 rounded-2xl shadow-2xl backdrop-blur-xl p-8 space-y-8 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500"></div>

            <div className="text-center">
              <h2 className="text-3xl font-extrabold tracking-tight text-white mb-1">Assessment Complete</h2>
              <p className="text-slate-400 text-sm">Exam submission has been automatically scored and proctored.</p>
            </div>

            {/* Score & Integrity Badges Row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Score card */}
              <div className="bg-slate-950 border border-slate-800/80 rounded-xl p-5 text-center flex flex-col items-center justify-center relative overflow-hidden group">
                <div className="absolute top-0 left-0 right-0 h-0.5 bg-indigo-500"></div>
                <span className="text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-2">Final Score</span>
                <span className="text-4xl font-extrabold text-white font-mono mb-1">{score} <span className="text-slate-500 text-lg">/ 10</span></span>
                <span className="text-xs text-indigo-400 font-semibold">{(score / 10) * 100}% Ratio</span>
              </div>

              {/* Pass Fail Card */}
              <div className="bg-slate-950 border border-slate-800/80 rounded-xl p-5 text-center flex flex-col items-center justify-center relative overflow-hidden">
                <div className={`absolute top-0 left-0 right-0 h-0.5 ${passed ? "bg-emerald-500" : "bg-rose-500"}`}></div>
                <span className="text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-2">Grading Status</span>
                <span className={`text-2xl font-black tracking-widest ${passed ? "text-emerald-500" : "text-rose-500"}`}>
                  {passed ? "PASSED" : "FAILED"}
                </span>
                <span className="text-xs text-slate-500 mt-1">Passing Mark: 6 / 10</span>
              </div>

              {/* Integrity status card */}
              <div className="bg-slate-950 border border-slate-800/80 rounded-xl p-5 text-center flex flex-col items-center justify-center relative overflow-hidden">
                <div className={`absolute top-0 left-0 right-0 h-0.5 ${isInvalidated ? "bg-rose-600" : "bg-emerald-500"}`}></div>
                <span className="text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-2">Integrity Status</span>
                
                {isInvalidated ? (
                  <span className="text-rose-500 text-lg font-bold uppercase tracking-wide flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-rose-600 animate-ping"></span>
                    Flagged
                  </span>
                ) : (
                  <span className="text-emerald-400 text-lg font-bold uppercase tracking-wide flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                    Verified Clean
                  </span>
                )}
                
                <span className="text-[10px] text-slate-500 mt-1 font-mono">Suspicion Score: {suspicionScore}/100</span>
              </div>
            </div>

            {/* Invalidation Alert Banner */}
            {isInvalidated && (
              <div className="bg-rose-950/20 border border-rose-900/60 rounded-xl p-4 flex gap-3 text-sm text-rose-300">
                <svg className="w-5 h-5 shrink-0 text-rose-500 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div className="space-y-1">
                  <h4 className="font-bold">Automated Integrity Warning</h4>
                  <p className="text-xs text-rose-400 leading-relaxed">
                    This attempt has been silently flagged and invalidated because the suspicion index crossed the threshold of 50 during proctoring checks.
                  </p>
                </div>
              </div>
            )}

            {/* Timeline Log */}
            <div className="space-y-3.5">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Proctoring Incident Timeline ({events.length} detected)
              </h3>
              
              <div className="bg-slate-950 border border-slate-850 rounded-xl p-4 max-h-48 overflow-y-auto space-y-3 text-xs divide-y divide-slate-900">
                {events.length === 0 ? (
                  <div className="text-center text-slate-600 py-6">
                    No anomalies or security infractions logged.
                  </div>
                ) : (
                  events.map((e, index) => (
                    <div key={e.id} className={`flex items-start justify-between gap-4 ${index > 0 ? "pt-3" : ""}`}>
                      <div className="space-y-0.5">
                        <div className="font-bold text-rose-400">{e.label}</div>
                        <div className="text-slate-400 leading-relaxed">{e.detail}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="font-mono text-slate-500 block">+{e.weight}pts</span>
                        <span className="text-[10px] text-slate-600 block">{e.timestamp.toLocaleTimeString()}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Actions Footer */}
            <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-slate-800/80">
              <button
                onClick={downloadReport}
                className="flex-1 bg-slate-950 border border-slate-800 hover:border-slate-700 active:bg-slate-900 text-slate-200 font-semibold py-3 px-4 rounded-xl transition-all flex items-center justify-center gap-2 group cursor-pointer"
              >
                <svg className="w-4 h-4 text-slate-400 group-hover:text-white transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download Integrity Report
              </button>

              <button
                onClick={() => setStep("welcome")}
                className="flex-1 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white font-semibold py-3 px-4 rounded-xl shadow-lg shadow-indigo-600/10 hover:shadow-indigo-600/25 transition-colors cursor-pointer"
              >
                Restart Session
              </button>
            </div>
          </div>
        </main>
      )}
    </div>
  );
}

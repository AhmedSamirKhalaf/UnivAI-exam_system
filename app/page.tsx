'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

declare global {
  interface Window {
    faceapi: any;
  }
}

const CONFIG = {
  faceDetectionIntervalMs: 3000,
  suspicionThreshold: 50,
  faceScoreWeight: 15,
  fullscreenExitWeight: 30,
  tabSwitchWeight: 25,
  copyPasteWeight: 20,
  devtoolsWeight: 35,
  multipleFacesWeight: 25,
  voiceMismatchWeight: 40,
  voiceEnrollDurationMs: 3000,
  voiceMonitorDurationMs: 2500,
  voiceMonitorIntervalMs: 5000,
  voiceSimilarityThreshold: 0.55,
  gradePassThreshold: 60,
  svModelKey: 'mobile-128',
};

const CORRECT_ANSWERS: Record<string, string> = { q1: 'a', q2: 'a', q3: 'b' };

const WEIGHTS: Record<string, number> = {
  fullscreen_exit: CONFIG.fullscreenExitWeight,
  tab_switch: CONFIG.tabSwitchWeight,
  copy_paste: CONFIG.copyPasteWeight,
  devtools_open: CONFIG.devtoolsWeight,
  face_not_detected: CONFIG.faceScoreWeight,
  multiple_faces: CONFIG.multipleFacesWeight,
  voice_mismatch: CONFIG.voiceMismatchWeight,
};

interface Violation {
  type: string;
  details: string;
  timestamp: string;
  timestampMs: number;
}

export default function ExamPage() {
  const [suspicionScore, setSuspicionScore] = useState(0);
  const [violations, setViolations] = useState<Violation[]>([]);
  const [started, setStarted] = useState(false);
  const [ended, setEnded] = useState(false);
  const [timer, setTimer] = useState('--:--');

  const [fsIndicator, setFsIndicator] = useState({ text: 'OFF', css: 'indicator indicator-off' });
  const [tabIndicator, setTabIndicator] = useState({ text: 'ACTIVE', css: 'indicator indicator-on' });
  const [dtIndicator, setDtIndicator] = useState({ text: 'CLEAN', css: 'indicator indicator-off' });
  const [faceIndicator, setFaceIndicator] = useState({ text: 'WAITING', css: 'indicator indicator-off' });
  const [voiceIndicator, setVoiceIndicator] = useState({ text: '\u2014', css: 'indicator indicator-off' });
  const [audioIndicator, setAudioIndicator] = useState({ text: 'SILENT', css: 'indicator indicator-off' });

  const [statusBadge, setStatusBadge] = useState({ text: 'INACTIVE', css: 'badge badge-idle' });
  const [camStatus, setCamStatus] = useState({ text: 'STOPPED', css: 'badge badge-idle' });
  const [voiceStatus, setVoiceStatus] = useState({ text: 'NOT ENROLLED', css: 'badge badge-idle' });

  const [voiceProgressPct, setVoiceProgressPct] = useState(0);
  const [voiceProgressText, setVoiceProgressText] = useState('');
  const [voiceProgressVisible, setVoiceProgressVisible] = useState(false);

  const [btnEnrollDisabled, setBtnEnrollDisabled] = useState(false);
  const [btnStartDisabled, setBtnStartDisabled] = useState(true);
  const [btnEndDisabled, setBtnEndDisabled] = useState(true);
  const [btnDlDisabled, setBtnDlDisabled] = useState(true);

  const verdict = suspicionScore >= CONFIG.suspicionThreshold
    ? { text: 'Status: Needs Review', css: 'verdict verdict-review' }
    : { text: 'Status: Clean', css: 'verdict verdict-clean' };

  const scoreColor = suspicionScore < 30 ? '#6ee7b7' : suspicionScore < 60 ? '#fbbf24' : '#fca5a5';

  const videoRef = useRef<HTMLVideoElement>(null);
  const violationListRef = useRef<HTMLDivElement>(null);
  const writtenRef = useRef<HTMLTextAreaElement>(null);

  const stateRef = useRef({
    started: false,
    ended: false,
    startTime: null as number | null,
    faceDetectorActive: false,
    faceDetectionInterval: null as ReturnType<typeof setInterval> | null,
    devtoolsOpen: false,
    voiceEnrolled: false,
    enrolledEmbedding: null as any,
    verifier: null as any,
    voiceMonitoringInterval: null as ReturnType<typeof setInterval> | null,
    svInitialized: false,
    stream: null as MediaStream | null,
    timerInterval: null as ReturnType<typeof setInterval> | null,
    devtoolsInterval: null as ReturnType<typeof setInterval> | null,
  });

  const addViolation = useCallback((type: string, details: string) => {
    const violation: Violation = {
      type,
      details,
      timestamp: new Date().toISOString(),
      timestampMs: Date.now(),
    };
    setViolations(prev => [...prev, violation]);
    setSuspicionScore(prev => Math.min(prev + (WEIGHTS[type] || 10), 100));
  }, []);

  const showVoiceProgress = useCallback((pct: number, text: string) => {
    setVoiceProgressPct(Math.min(pct, 100));
    setVoiceProgressText(text);
    setVoiceProgressVisible(true);
  }, []);

  const recordAudio = useCallback((durationMs: number): Promise<Blob> => {
    return new Promise(async (resolve, reject) => {
      try {
        const ms = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new MediaRecorder(ms, { mimeType: 'audio/webm;codecs=opus' });
        const chunks: Blob[] = [];
        recorder.ondataavailable = (e) => chunks.push(e.data);
        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: 'audio/webm' });
          ms.getTracks().forEach((t) => t.stop());
          resolve(blob);
        };
        recorder.onerror = () => reject(new Error('Recorder error'));
        recorder.start();
        setTimeout(() => {
          if (recorder.state === 'recording') recorder.stop();
        }, durationMs);
      } catch (e) {
        reject(e);
      }
    });
  }, []);

  const resampleAudio = useCallback((audioData: Float32Array, origRate: number, targetRate: number): Float32Array => {
    if (origRate === targetRate) return audioData;
    const ratio = origRate / targetRate;
    const newLen = Math.round(audioData.length / ratio);
    const out = new Float32Array(newLen);
    for (let i = 0; i < newLen; i++) {
      const pos = i * ratio;
      const idx = Math.floor(pos);
      const frac = pos - idx;
      out[i] =
        idx + 1 < audioData.length
          ? audioData[idx] * (1 - frac) + audioData[idx + 1] * frac
          : audioData[idx];
    }
    return out;
  }, []);

  const blobToPcm16k = useCallback(async (blob: Blob): Promise<Float32Array> => {
    const buf = await blob.arrayBuffer();
    const ctx = new AudioContext();
    const ab = await ctx.decodeAudioData(buf);
    const sr = ab.sampleRate;
    const ch = ab.getChannelData(0);
    ctx.close();
    return resampleAudio(ch, sr, 16000);
  }, [resampleAudio]);

  const gradeExam = useCallback(() => {
    let correct = 0;
    let total = 0;
    for (const key in CORRECT_ANSWERS) {
      total++;
      const el = document.querySelector(`input[name="${key}"]:checked`) as HTMLInputElement | null;
      if (el && el.value === CORRECT_ANSWERS[key]) correct++;
    }
    const written = writtenRef.current ? writtenRef.current.value.trim() : '';
    const grade = total > 0 ? Math.round((correct / total) * 100) : 0;
    return { grade, correct, total, passed: grade >= CONFIG.gradePassThreshold, writtenAnswer: written, writtenLength: written.length };
  }, []);

  const generateReport = useCallback(() => {
    const result = gradeExam();
    const endTime = new Date().toISOString();
    const st = stateRef.current;
    const durationSec = st.startTime ? Math.round((Date.now() - st.startTime) / 1000) : 0;
    const fmt = (s: number) => Math.floor(s / 60) + 'm ' + (s % 60) + 's';
    const score = Math.min(suspicionScore, 100);
    const needsReview = score >= CONFIG.suspicionThreshold;

    return {
      examSession: {
        startTime: st.startTime || endTime,
        endTime,
        duration: fmt(durationSec),
        durationSeconds: durationSec,
      },
      grading: {
        mcq: { correct: result.correct, total: result.total, grade: result.grade + '%', passed: result.passed },
        written: { question: 'Q4', answerLength: result.writtenLength, answer: result.writtenAnswer, gradedBy: 'manual_review' },
      },
      monitoring: {
        totalViolations: violations.length,
        suspicionScore: score,
        needsReview,
        faceDetection: st.faceDetectorActive ? 'active' : 'unavailable',
        voiceEnrolled: st.voiceEnrolled,
        speakerVerificationModel: CONFIG.svModelKey,
        verdict: needsReview ? 'HUMAN_REVIEW' : 'CLEAN',
      },
      violations,
      timeline: violations.map((v) => ({ time: v.timestamp, event: v.type, detail: v.details })),
    };
  }, [gradeExam, suspicionScore, violations]);

  // ─── Fullscreen ─────────────────────────────────────────────
  const enterFullscreen = useCallback(() => {
    const el = document.documentElement;
    const m = el.requestFullscreen || (el as any).webkitRequestFullscreen || (el as any).msRequestFullscreen;
    if (m) m.call(el).catch(() => {});
  }, []);

  const exitFullscreen = useCallback(() => {
    try {
      const m = document.exitFullscreen || (document as any).webkitExitFullscreen || (document as any).msExitFullscreen;
      if (m) m.call(document);
    } catch {}
  }, []);

  // ─── Voice Enrollment ──────────────────────────────────────
  const initSpeakerVerifier = useCallback(async (): Promise<boolean> => {
    const st = stateRef.current;
    if (st.svInitialized) return true;
    showVoiceProgress(5, 'Loading AI speaker verification model (5MB)...');

    try {
      const { SpeakerVerification } = await import('@jaehyun-ko/speaker-verification');
      const ort = await import('onnxruntime-web');
      (ort as any).env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/';

      st.verifier = new SpeakerVerification();
      await st.verifier.initialize(CONFIG.svModelKey);
      st.svInitialized = true;
      showVoiceProgress(100, 'AI model loaded! Ready to enroll.');
      return true;
    } catch (err: any) {
      showVoiceProgress(0, 'Failed to load model: ' + err.message);
      return false;
    }
  }, [showVoiceProgress]);

  const enrollVoice = useCallback(async () => {
    setBtnEnrollDisabled(true);
    setVoiceStatus({ text: 'LOADING', css: 'badge badge-warn' });

    const modelOk = await initSpeakerVerifier();
    if (!modelOk) {
      setBtnEnrollDisabled(false);
      setVoiceStatus({ text: 'MODEL FAIL', css: 'badge badge-alert' });
      return;
    }

    showVoiceProgress(10, 'Recording voice sample (3 seconds)... Speak naturally.');
    setVoiceStatus({ text: 'RECORDING', css: 'badge badge-alert' });

    let blob: Blob;
    try {
      blob = await recordAudio(CONFIG.voiceEnrollDurationMs);
    } catch {
      showVoiceProgress(0, 'Microphone access denied');
      setVoiceStatus({ text: 'MIC FAIL', css: 'badge badge-alert' });
      setBtnEnrollDisabled(false);
      return;
    }

    showVoiceProgress(50, 'Processing audio... extracting voice signature.');

    let pcm: Float32Array;
    try {
      pcm = await blobToPcm16k(blob);
    } catch {
      showVoiceProgress(0, 'Audio processing failed');
      setVoiceStatus({ text: 'AUDIO ERR', css: 'badge badge-alert' });
      setBtnEnrollDisabled(false);
      return;
    }

    showVoiceProgress(70, 'Running AI model...');

    try {
      const st = stateRef.current;
      st.enrolledEmbedding = await st.verifier.getEmbedding(pcm);
      st.voiceEnrolled = true;

      setVoiceStatus({ text: 'ENROLLED', css: 'badge badge-active' });
      setVoiceIndicator({ text: 'READY', css: 'indicator indicator-on' });
      setBtnStartDisabled(false);
      showVoiceProgress(100, 'Voice enrolled successfully! You can now start the exam.');
    } catch (err: any) {
      showVoiceProgress(0, 'Embedding failed: ' + err.message);
      setVoiceStatus({ text: 'EMBED FAIL', css: 'badge badge-alert' });
      setBtnEnrollDisabled(false);
    }
  }, [initSpeakerVerifier, showVoiceProgress, recordAudio, blobToPcm16k]);

  const checkVoice = useCallback(async () => {
    const st = stateRef.current;
    if (!st.verifier || !st.enrolledEmbedding || st.ended) return;

    let blob: Blob;
    try {
      blob = await recordAudio(CONFIG.voiceMonitorDurationMs);
    } catch {
      return;
    }

    let pcm: Float32Array;
    try {
      pcm = await blobToPcm16k(blob);
    } catch {
      return;
    }

    try {
      const emb = await st.verifier.getEmbedding(pcm);
      const sim = await st.verifier.compareEmbeddings(st.enrolledEmbedding, emb);

      if (sim >= CONFIG.voiceSimilarityThreshold) {
        setVoiceIndicator({ text: 'MATCH', css: 'indicator indicator-on' });
        setAudioIndicator({ text: 'VOICE OK', css: 'indicator indicator-on' });
      } else {
        addViolation('voice_mismatch', `Speaker mismatch (similarity: ${sim.toFixed(2)})`);
        setVoiceIndicator({ text: 'MISMATCH', css: 'indicator indicator-alert' });
        setAudioIndicator({ text: 'OTHER VOICE', css: 'indicator indicator-alert' });
      }
    } catch {}
  }, [recordAudio, blobToPcm16k, addViolation]);

  const startVoiceMonitoring = useCallback(() => {
    const st = stateRef.current;
    if (st.voiceMonitoringInterval) clearInterval(st.voiceMonitoringInterval);
    st.voiceMonitoringInterval = setInterval(checkVoice, CONFIG.voiceMonitorIntervalMs);
  }, [checkVoice]);

  const stopVoiceMonitoring = useCallback(() => {
    const st = stateRef.current;
    if (st.voiceMonitoringInterval) {
      clearInterval(st.voiceMonitoringInterval);
      st.voiceMonitoringInterval = null;
    }
  }, []);

  // ─── Face Detection ─────────────────────────────────────────
  const setupFaceDetection = useCallback(async (): Promise<boolean> => {
    const video = videoRef.current;
    if (!video) return false;
    try {
      const ms = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
        audio: false,
      });
      stateRef.current.stream = ms;
      video.srcObject = ms;
      await video.play();
      setCamStatus({ text: 'ACTIVE', css: 'badge badge-active' });
      return true;
    } catch {
      setCamStatus({ text: 'BLOCKED', css: 'badge badge-alert' });
      return false;
    }
  }, []);

  const stopCamera = useCallback(() => {
    const st = stateRef.current;
    if (st.stream) {
      st.stream.getTracks().forEach((t) => t.stop());
      st.stream = null;
    }
    setCamStatus({ text: 'STOPPED', css: 'badge badge-idle' });
  }, []);

  const initFaceApi = useCallback(async (): Promise<boolean> => {
    if (typeof window === 'undefined' || !window.faceapi) {
      setCamStatus({ text: 'NO LIB', css: 'badge badge-alert' });
      return false;
    }
    try {
      await window.faceapi.nets.tinyFaceDetector.loadFromUri(
        'https://justadudewhohacks.github.io/face-api.js/models'
      );
      stateRef.current.faceDetectorActive = true;
      setFaceIndicator({ text: 'READY', css: 'indicator indicator-off' });
      return true;
    } catch {
      setCamStatus({ text: 'MODEL FAIL', css: 'badge badge-alert' });
      return false;
    }
  }, []);

  const runFaceDetection = useCallback(async () => {
    const st = stateRef.current;
    if (!st.started || st.ended || !st.faceDetectorActive) return;
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;
    try {
      const detections = await window.faceapi.detectAllFaces(
        video,
        new window.faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 })
      );
      if (detections.length === 0) {
        addViolation('face_not_detected', 'No face visible');
        setFaceIndicator({ text: 'NOT FOUND', css: 'indicator indicator-alert' });
      } else if (detections.length > 1) {
        addViolation('multiple_faces', detections.length + ' faces detected');
        setFaceIndicator({ text: 'MULTIPLE', css: 'indicator indicator-warn' });
      } else {
        setFaceIndicator({ text: 'OK', css: 'indicator indicator-on' });
      }
    } catch {}
  }, [addViolation]);

  const startFaceLoop = useCallback(() => {
    const st = stateRef.current;
    if (st.faceDetectionInterval) clearInterval(st.faceDetectionInterval);
    st.faceDetectionInterval = setInterval(runFaceDetection, CONFIG.faceDetectionIntervalMs);
  }, [runFaceDetection]);

  const stopFaceLoop = useCallback(() => {
    const st = stateRef.current;
    if (st.faceDetectionInterval) {
      clearInterval(st.faceDetectionInterval);
      st.faceDetectionInterval = null;
    }
  }, []);

  // ─── Timer ─────────────────────────────────────────────────
  const startTimer = useCallback(() => {
    const st = stateRef.current;
    if (st.timerInterval) clearInterval(st.timerInterval);
    st.timerInterval = setInterval(() => {
      if (!st.startTime) return;
      const elapsed = Math.floor((Date.now() - st.startTime) / 1000);
      setTimer(
        String(Math.floor(elapsed / 60)).padStart(2, '0') + ':' + String(elapsed % 60).padStart(2, '0')
      );
    }, 1000);
  }, []);

  const stopTimer = useCallback(() => {
    const st = stateRef.current;
    if (st.timerInterval) {
      clearInterval(st.timerInterval);
      st.timerInterval = null;
    }
  }, []);

  // ─── Exam Controls ─────────────────────────────────────────
  const startExam = useCallback(async () => {
    const st = stateRef.current;
    if (st.started) return;
    st.started = true;
    st.startTime = Date.now();
    setStarted(true);

    setBtnStartDisabled(true);
    setBtnEndDisabled(false);
    setBtnDlDisabled(true);
    setBtnEnrollDisabled(true);
    setStatusBadge({ text: 'ACTIVE', css: 'badge badge-active' });

    enterFullscreen();

    const camOk = await setupFaceDetection();
    if (camOk) {
      const faceOk = await initFaceApi();
      if (faceOk) startFaceLoop();
    }

    if (st.voiceEnrolled) startVoiceMonitoring();

    addViolation('session_start', 'Exam started. Voice enrolled: ' + st.voiceEnrolled);
    startTimer();
  }, [enterFullscreen, setupFaceDetection, initFaceApi, startFaceLoop, startVoiceMonitoring, addViolation, startTimer]);

  const endExam = useCallback(() => {
    const st = stateRef.current;
    if (!st.started || st.ended) return;
    st.ended = true;
    setEnded(true);

    stopFaceLoop();
    stopVoiceMonitoring();
    stopCamera();
    exitFullscreen();

    setBtnStartDisabled(true);
    setBtnEndDisabled(true);
    setBtnDlDisabled(false);
    setStatusBadge({ text: 'ENDED', css: 'badge badge-idle' });
    setFsIndicator({ text: 'OFF', css: 'indicator indicator-off' });
    setFaceIndicator({ text: 'STOP', css: 'indicator indicator-off' });
    setVoiceIndicator({ text: 'STOP', css: 'indicator indicator-off' });
    setAudioIndicator({ text: 'STOP', css: 'indicator indicator-off' });

    addViolation('session_end', 'Exam ended');
    stopTimer();
  }, [stopFaceLoop, stopVoiceMonitoring, stopCamera, exitFullscreen, addViolation, stopTimer]);

  const downloadViolationsJSON = useCallback(() => {
    const report = generateReport();
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'violations.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [generateReport]);

  // ─── Global Event Listeners ────────────────────────────────
  useEffect(() => {
    const st = stateRef.current;

    const handleFullscreenChange = () => {
      const isFs = !!document.fullscreenElement || !!(document as any).webkitFullscreenElement;
      if (st.started && !st.ended && !isFs) {
        addViolation('fullscreen_exit', 'User exited fullscreen mode');
        setFsIndicator({ text: 'OFF', css: 'indicator indicator-alert' });
      } else if (isFs) {
        setFsIndicator({ text: 'ON', css: 'indicator indicator-on' });
      }
    };

    const blockEvent = (e: Event) => {
      if (st.started && !st.ended) {
        e.preventDefault();
        addViolation('copy_paste', 'Tried to ' + e.type);
        return false;
      }
    };

    const handleContextmenu = (e: Event) => {
      if (st.started && !st.ended) {
        e.preventDefault();
        addViolation('copy_paste', 'Right-click context menu');
      }
    };

    const handleVisibilityChange = () => {
      if (st.started && !st.ended) {
        if (document.hidden) {
          addViolation('tab_switch', 'Tab hidden / switched away');
          setTabIndicator({ text: 'HIDDEN', css: 'indicator indicator-warn' });
        } else {
          setTabIndicator({ text: 'ACTIVE', css: 'indicator indicator-on' });
        }
      }
    };

    const handleBlur = () => {
      if (st.started && !st.ended) {
        addViolation('tab_switch', 'Window lost focus (Alt+Tab / minimize)');
        setTabIndicator({ text: 'BLUR', css: 'indicator indicator-warn' });
      }
    };

    const handleFocus = () => {
      if (st.started && !st.ended) {
        setTabIndicator({ text: 'ACTIVE', css: 'indicator indicator-on' });
      }
    };

    const handleKeydown = (e: KeyboardEvent) => {
      if (st.started && !st.ended) {
        if (
          e.key === 'F12' ||
          (e.ctrlKey && e.shiftKey && ['I', 'J', 'C'].includes(e.key)) ||
          (e.ctrlKey && e.key === 'U')
        ) {
          e.preventDefault();
          addViolation('devtools_open', 'DevTools shortcut: ' + e.key);
          return false;
        }
      }
    };

    const detectDevTools = () => {
      const threshold = 160;
      const isOpen =
        window.outerWidth - window.innerWidth > threshold ||
        window.outerHeight - window.innerHeight > threshold;
      if (isOpen !== st.devtoolsOpen) {
        st.devtoolsOpen = isOpen;
        if (st.started && !st.ended && isOpen) {
          addViolation('devtools_open', 'Developer tools detected');
          setDtIndicator({ text: 'OPEN', css: 'indicator indicator-alert' });
        } else if (!isOpen) {
          setDtIndicator({ text: 'CLEAN', css: 'indicator indicator-off' });
        }
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('copy', blockEvent);
    document.addEventListener('cut', blockEvent);
    document.addEventListener('paste', blockEvent);
    document.addEventListener('contextmenu', handleContextmenu);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('keydown', handleKeydown);

    st.devtoolsInterval = setInterval(detectDevTools, 1000);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('copy', blockEvent);
      document.removeEventListener('cut', blockEvent);
      document.removeEventListener('paste', blockEvent);
      document.removeEventListener('contextmenu', handleContextmenu);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('keydown', handleKeydown);
      if (st.devtoolsInterval) clearInterval(st.devtoolsInterval);
      stopFaceLoop();
      stopVoiceMonitoring();
      stopCamera();
      stopTimer();
    };
  }, [addViolation, stopFaceLoop, stopVoiceMonitoring, stopCamera, stopTimer]);

  return (
    <div id="app">
      <header>
        <h1>Exam Monitoring System</h1>
        <p className="subtitle">
          Proof of Concept &mdash; All processing is local. No data leaves your browser.
        </p>
      </header>

      <main>
        <div className="grid">
          {/* Left Column: Exam Content */}
          <section className="exam-section">
            <div className="card">
              <div className="card-header">
                <h2>Sample Exam</h2>
                <span className="timer">{timer}</span>
              </div>
              <div className="card-body">
                <div id="exam-content">
                  <div className="question">
                    <p className="q-text"><strong>Q1.</strong> What does HTML stand for?</p>
                    <label><input type="radio" name="q1" value="a" /> A) Hyper Text Markup Language</label>
                    <label><input type="radio" name="q1" value="b" /> B) High Tech Modern Language</label>
                    <label><input type="radio" name="q1" value="c" /> C) Hyper Transfer Markup Language</label>
                    <label><input type="radio" name="q1" value="d" /> D) None of the above</label>
                  </div>
                  <div className="question">
                    <p className="q-text"><strong>Q2.</strong> Which method is used to parse JSON in JavaScript?</p>
                    <label><input type="radio" name="q2" value="a" /> A) JSON.parse()</label>
                    <label><input type="radio" name="q2" value="b" /> B) JSON.stringify()</label>
                    <label><input type="radio" name="q2" value="c" /> C) JSON.convert()</label>
                    <label><input type="radio" name="q2" value="d" /> D) JSON.toObject()</label>
                  </div>
                  <div className="question">
                    <p className="q-text"><strong>Q3.</strong> What does CSS stand for?</p>
                    <label><input type="radio" name="q3" value="a" /> A) Computer Style Sheets</label>
                    <label><input type="radio" name="q3" value="b" /> B) Cascading Style Sheets</label>
                    <label><input type="radio" name="q3" value="c" /> C) Creative Style System</label>
                    <label><input type="radio" name="q3" value="d" /> D) Colorful Style Sheets</label>
                  </div>
                  <div className="question">
                    <p className="q-text">
                      <strong>Q4 (Written).</strong> Explain the difference between <code>let</code> and{' '}
                      <code>var</code> in JavaScript.
                    </p>
                    <textarea
                      ref={writtenRef}
                      name="q4"
                      className="written-answer"
                      rows={4}
                      placeholder="Type your answer here..."
                    />
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Right Column: Monitoring */}
          <section className="monitoring-section">
            {/* Status Panel */}
            <div className="card status-card">
              <div className="card-header">
                <h2>Monitoring Status</h2>
                <span className={`badge ${statusBadge.css.split(' ')[1]}`}>{statusBadge.text}</span>
              </div>
              <div className="card-body">
                <div className="status-grid">
                  <div className="status-item">
                    <span className="status-label">Fullscreen</span>
                    <span className={fsIndicator.css}>{fsIndicator.text}</span>
                  </div>
                  <div className="status-item">
                    <span className="status-label">Tab Focus</span>
                    <span className={tabIndicator.css}>{tabIndicator.text}</span>
                  </div>
                  <div className="status-item">
                    <span className="status-label">DevTools</span>
                    <span className={dtIndicator.css}>{dtIndicator.text}</span>
                  </div>
                  <div className="status-item">
                    <span className="status-label">Face</span>
                    <span className={faceIndicator.css}>{faceIndicator.text}</span>
                  </div>
                  <div className="status-item">
                    <span className="status-label">Voice</span>
                    <span className={voiceIndicator.css}>{voiceIndicator.text}</span>
                  </div>
                  <div className="status-item">
                    <span className="status-label">Audio</span>
                    <span className={audioIndicator.css}>{audioIndicator.text}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Suspicion Score */}
            <div className="card">
              <div className="card-header">
                <h2>Suspicion Score</h2>
                <span className="score" style={{ color: scoreColor }}>
                  {suspicionScore}
                </span>
              </div>
              <div className="card-body">
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${suspicionScore}%` }} />
                </div>
                <p className={verdict.css}>{verdict.text}</p>
              </div>
            </div>

            {/* Webcam */}
            <div className="card">
              <div className="card-header">
                <h2>Webcam Feed</h2>
                <span className={`badge ${camStatus.css.split(' ')[1]}`}>{camStatus.text}</span>
              </div>
              <div className="card-body">
                <video ref={videoRef} autoPlay muted playsInline style={{ width: '100%', borderRadius: '0.5rem', background: '#0f172a' }} />
                <canvas id="canvas-overlay" />
              </div>
            </div>

            {/* Voice Enrollment */}
            <div className="card" id="voice-card">
              <div className="card-header">
                <h2>Voice Enrollment</h2>
                <span className={`badge ${voiceStatus.css.split(' ')[1]}`}>{voiceStatus.text}</span>
              </div>
              <div className="card-body">
                <p className="voice-hint">
                  Enroll your voice using an AI speaker verification model. The model (~5MB)
                  downloads once and caches locally.
                </p>
                <div className="voice-controls">
                  <button
                    className="btn btn-primary"
                    disabled={btnEnrollDisabled}
                    onClick={enrollVoice}
                  >
                    Enroll Voice
                  </button>
                </div>
                {voiceProgressVisible && (
                  <div className="voice-progress">
                    <div className="progress-bar">
                      <div className="progress-fill" style={{ width: `${voiceProgressPct}%` }} />
                    </div>
                    <p className="voice-hint">{voiceProgressText}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Controls */}
            <div className="card">
              <div className="card-body controls">
                <button
                  className="btn btn-primary"
                  disabled={btnStartDisabled}
                  onClick={startExam}
                >
                  Start Exam
                </button>
                <button
                  className="btn btn-danger"
                  disabled={btnEndDisabled}
                  onClick={endExam}
                >
                  End Exam
                </button>
                <button
                  className="btn btn-secondary"
                  disabled={btnDlDisabled}
                  onClick={downloadViolationsJSON}
                >
                  Download violations.json
                </button>
              </div>
            </div>
          </section>
        </div>

        {/* Violations Log */}
        <section className="log-section">
          <div className="card">
            <div className="card-header">
              <h2>Violations Log</h2>
              <span className="badge">{violations.length}</span>
            </div>
            <div className="card-body">
              <div ref={violationListRef} className="violation-list">
                {violations.length === 0 ? (
                  <p className="empty-state">No violations yet. Start the exam to begin monitoring.</p>
                ) : (
                  violations.map((v, i) => (
                    <div
                      key={i}
                      className={`violation-item${
                        ['devtools_open', 'fullscreen_exit', 'voice_mismatch'].includes(v.type) ? ' alert' : ''
                      }`}
                    >
                      <span>
                        <span className="violation-type">{v.type.replace(/_/g, ' ')}</span>{' '}
                        <span className="violation-details">{v.details}</span>
                      </span>
                      <span className="violation-time">
                        {new Date(v.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

"use client";

import { useEffect, useRef, useCallback, useState } from "react";

declare global {
  interface Window {
    faceapi: any;
  }
}

export interface Violation {
  type: string;
  details: string;
  timestamp: string;
}

const FACE_API_SRC =
  "https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js";
const FACE_API_MODELS =
  "https://justadudewhohacks.github.io/face-api.js/models";

function timestamp() {
  return new Date().toISOString();
}

export default function useMonitor(active: boolean, externalVideoRef?: React.RefObject<HTMLVideoElement | null>) {
  const [violations, setViolations] = useState<Violation[]>([]);
  const internalVideoRef = useRef<HTMLVideoElement | null>(null);
  const videoRef = externalVideoRef || internalVideoRef;
  const streamRef = useRef<MediaStream | null>(null);
  const faceReady = useRef(false);
  const intervals = useRef<ReturnType<typeof setInterval>[]>([]);
  const started = useRef(false);

  const log = useCallback((type: string, details: string) => {
    setViolations((prev) => [...prev, { type, details, timestamp: timestamp() }]);
  }, []);

  // ---- load face-api.js ----
  useEffect(() => {
    if (!active) return;
    if (window.faceapi) return;
    const s = document.createElement("script");
    s.src = FACE_API_SRC;
    s.onload = () => {
      window.faceapi.nets.tinyFaceDetector
        .loadFromUri(FACE_API_MODELS)
        .then(() => {
          faceReady.current = true;
        })
        .catch(() => {});
    };
    document.body.appendChild(s);
  }, [active]);

  // ---- camera ----
  useEffect(() => {
    if (!active) return;
    const video = videoRef.current;
    if (!video) return;

    navigator.mediaDevices
      .getUserMedia({ video: { width: 640, height: 480, facingMode: "user" }, audio: false })
      .then((stream) => {
        streamRef.current = stream;
        video.srcObject = stream;
        video.play();
      })
      .catch(() => {
        log("camera_blocked", "Camera access denied");
      });

    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [active, log, videoRef]);

  // ---- face detection loop ----
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      const video = videoRef.current;
      if (!video || video.readyState < 2 || !faceReady.current || !window.faceapi) return;
      window.faceapi
        .detectAllFaces(video, new window.faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
        .then((detections: any[]) => {
          if (detections.length === 0) log("face_not_detected", "No face visible");
          else if (detections.length > 1) log("multiple_faces", `${detections.length} faces detected`);
        })
        .catch(() => {});
    }, 3000);
    intervals.current.push(id);
    return () => clearInterval(id);
  }, [active, log]);

  // ---- browser event listeners ----
  useEffect(() => {
    if (!active || started.current) return;
    started.current = true;

    const onFullscreenChange = () => {
      const isFs = !!document.fullscreenElement || !!(document as any).webkitFullscreenElement;
      if (!isFs) log("fullscreen_exit", "Exited fullscreen mode");
    };

    const onCopy = (e: Event) => {
      e.preventDefault();
      log("copy_paste", "Copy attempted");
    };
    const onCut = (e: Event) => {
      e.preventDefault();
      log("copy_paste", "Cut attempted");
    };
    const onPaste = (e: Event) => {
      e.preventDefault();
      log("copy_paste", "Paste attempted");
    };

    const onContextmenu = (e: Event) => {
      e.preventDefault();
      log("copy_paste", "Right-click context menu");
    };

    const onVisibilityChange = () => {
      if (document.hidden) log("tab_switch", "Tab hidden / switched away");
    };

    const onBlur = () => log("tab_switch", "Window lost focus");

    const onKeydown = (e: KeyboardEvent) => {
      if (
        e.key === "F12" ||
        (e.ctrlKey && e.shiftKey && ["I", "J", "C"].includes(e.key)) ||
        (e.ctrlKey && e.key === "U")
      ) {
        e.preventDefault();
        log("devtools_open", `DevTools shortcut: ${e.key}`);
      }
    };

    let devtoolsOpen = false;
    const detectDevTools = () => {
      const threshold = 160;
      const isOpen =
        window.outerWidth - window.innerWidth > threshold ||
        window.outerHeight - window.innerHeight > threshold;
      if (isOpen !== devtoolsOpen) {
        devtoolsOpen = isOpen;
        if (isOpen) log("devtools_open", "Developer tools detected");
      }
    };

    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("webkitfullscreenchange", onFullscreenChange);
    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCut);
    document.addEventListener("paste", onPaste);
    document.addEventListener("contextmenu", onContextmenu);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("blur", onBlur);
    document.addEventListener("keydown", onKeydown);

    const devtoolsId = setInterval(detectDevTools, 1000);
    intervals.current.push(devtoolsId);

    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", onFullscreenChange);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCut);
      document.removeEventListener("paste", onPaste);
      document.removeEventListener("contextmenu", onContextmenu);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("keydown", onKeydown);
      clearInterval(devtoolsId);
      started.current = false;
    };
  }, [active, log]);

  // ---- cleanup all intervals on unmount ----
  useEffect(() => {
    return () => {
      intervals.current.forEach((id) => clearInterval(id));
      intervals.current = [];
    };
  }, []);

  return { violations };
}

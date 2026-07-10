export interface ProctoringConfig {
  faceDetectionIntervalMs: number;
  suspicionThreshold: number;
  faceScoreWeight: number;
  fullscreenExitWeight: number;
  tabSwitchWeight: number;
  copyPasteWeight: number;
  devtoolsWeight: number;
  multipleFacesWeight: number;
  duplicateEventWindowMs: number;
}

export const PROCTORING_CONFIG: ProctoringConfig = {
  faceDetectionIntervalMs: 3000,
  suspicionThreshold: 50,
  faceScoreWeight: 15,
  fullscreenExitWeight: 30,
  tabSwitchWeight: 25,
  copyPasteWeight: 20,
  devtoolsWeight: 35,
  multipleFacesWeight: 25,
  duplicateEventWindowMs: 5000,
} as const;

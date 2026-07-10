export interface ProctoringConfig {
  faceDetectionIntervalMs: number;
  faceDetectionExamTypes: string[];
  suspicionThreshold: number;
  faceScoreWeight: number;
  fullscreenExitWeight: number;
  tabSwitchWeight: number;
  copyPasteWeight: number;
  devtoolsWeight: number;
  multipleFacesWeight: number;
  duplicateEventWindowMs: number;
  absenceScoreIntervalSeconds: number;
  maxAbsenceEventWeight: number;
}

export const PROCTORING_CONFIG: ProctoringConfig = {
  faceDetectionIntervalMs: 3000,
  faceDetectionExamTypes: ["mid", "final"],
  suspicionThreshold: 50,
  faceScoreWeight: 15,
  fullscreenExitWeight: 30,
  tabSwitchWeight: 25,
  copyPasteWeight: 20,
  devtoolsWeight: 35,
  multipleFacesWeight: 25,
  duplicateEventWindowMs: 5000,
  absenceScoreIntervalSeconds: 15,
  maxAbsenceEventWeight: 60,
};

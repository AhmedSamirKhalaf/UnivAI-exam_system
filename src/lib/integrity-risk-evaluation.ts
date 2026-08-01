export type CalibrationSample = {
  session_id: string;
  label: 0 | 1;
  probability: number;
  group?: string;
};

export type ReliabilityBin = {
  lower: number;
  upper: number;
  count: number;
  meanPrediction: number;
  observedRate: number;
};

export type EvaluationResult = {
  sampleCount: number;
  positiveCount: number;
  brierScore: number;
  logLoss: number;
  expectedCalibrationError: number;
  threshold: number;
  confusion: { truePositive: number; falsePositive: number; trueNegative: number; falseNegative: number };
  reliability: ReliabilityBin[];
};

function assertSamples(samples: CalibrationSample[]): void {
  if (!samples.length) throw new Error("At least one labeled sample is required");
  for (const sample of samples) {
    if ((sample.label !== 0 && sample.label !== 1) || sample.probability < 0 || sample.probability > 1) {
      throw new Error(`Invalid labeled prediction for ${sample.session_id}`);
    }
  }
}

export function evaluateRiskPredictions(
  samples: CalibrationSample[],
  options: { bins?: number; threshold?: number } = {},
): EvaluationResult {
  assertSamples(samples);
  const binCount = options.bins ?? 10;
  const threshold = options.threshold ?? 0.5;
  if (!Number.isInteger(binCount) || binCount < 2) throw new Error("bins must be an integer of at least 2");
  if (threshold < 0 || threshold > 1) throw new Error("threshold must be between 0 and 1");

  const bins = Array.from({ length: binCount }, (_, index) => ({
    lower: index / binCount,
    upper: (index + 1) / binCount,
    values: [] as CalibrationSample[],
  }));
  let squaredError = 0;
  let logLoss = 0;
  const confusion = { truePositive: 0, falsePositive: 0, trueNegative: 0, falseNegative: 0 };

  for (const sample of samples) {
    squaredError += (sample.probability - sample.label) ** 2;
    const bounded = Math.min(1 - 1e-15, Math.max(1e-15, sample.probability));
    logLoss -= sample.label * Math.log(bounded) + (1 - sample.label) * Math.log(1 - bounded);
    bins[Math.min(binCount - 1, Math.floor(sample.probability * binCount))].values.push(sample);
    const predicted = sample.probability >= threshold;
    if (predicted && sample.label === 1) confusion.truePositive += 1;
    else if (predicted) confusion.falsePositive += 1;
    else if (sample.label === 0) confusion.trueNegative += 1;
    else confusion.falseNegative += 1;
  }

  const reliability = bins.map((bin) => {
    const count = bin.values.length;
    return {
      lower: bin.lower,
      upper: bin.upper,
      count,
      meanPrediction: count
        ? bin.values.reduce((sum, sample) => sum + sample.probability, 0) / count
        : 0,
      observedRate: count
        ? bin.values.reduce((sum, sample) => sum + sample.label, 0) / count
        : 0,
    };
  });
  const expectedCalibrationError = reliability.reduce(
    (sum, bin) => sum + (bin.count / samples.length) * Math.abs(bin.meanPrediction - bin.observedRate),
    0,
  );

  return {
    sampleCount: samples.length,
    positiveCount: samples.reduce((sum, sample) => sum + sample.label, 0),
    brierScore: squaredError / samples.length,
    logLoss: logLoss / samples.length,
    expectedCalibrationError,
    threshold,
    confusion,
    reliability,
  };
}

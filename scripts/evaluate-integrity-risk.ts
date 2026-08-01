import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  evaluateRiskPredictions,
  type CalibrationSample,
} from "../src/lib/integrity-risk-evaluation";

async function main(): Promise<void> {
  const input = process.argv[2];
  if (!input) throw new Error("Usage: npm run risk:evaluate -- <labeled-predictions.json>");
  const samples = JSON.parse(await readFile(resolve(input), "utf8")) as CalibrationSample[];
  const overall = evaluateRiskPredictions(samples);
  const groups = Object.fromEntries(
    [...new Set(samples.map((sample) => sample.group).filter((group): group is string => Boolean(group)))]
      .map((group) => [group, evaluateRiskPredictions(samples.filter((sample) => sample.group === group))]),
  );
  process.stdout.write(`${JSON.stringify({ overall, groups }, null, 2)}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exitCode = 1;
});

#!/usr/bin/env node

/**
 * run-evaluation.mjs — Mock-mode evaluation runner for grounded-v1.jsonl
 *
 * Reads the dataset, accepts recorded Agent outputs (in mock mode or real mode),
 * and produces machine-readable pass/fail results.
 *
 * Usage:
 *   node tests/capstone/run-evaluation.mjs --mode mock
 *   node tests/capstone/run-evaluation.mjs --mode real --agent-outputs ./agent-responses.json
 *
 * --mode mock    Uses built-in mock responses for deterministic testing.
 * --mode real    Requires --agent-outputs pointing to a JSON file with actual Agent responses.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/* ──────────────────────────────────────────────
   Mock responses for deterministic CI testing
   ────────────────────────────────────────────── */
function buildMockResponse(caseObj) {
  if (caseObj.expected.refused) {
    return {
      answer: "I cannot answer this question as it falls outside the curriculum.",
      refused: true,
      sources: [],
    };
  }

  const sourceIds = caseObj.expected.source_ids || [];
  const sourceLocations = caseObj.expected.source_locations || [];
  const answerText =
    caseObj.category === "malformed_structured_output"
      ? caseObj.id === "gv1-039"
        ? "4"
        : caseObj.id === "gv1-040"
          ? '["Algorithms & Complexity","Data Structures","Programming Paradigms","Computer Architecture"]'
          : "PASS"
      : `Based on the curriculum materials (${sourceLocations.join(", ") || "various chapters"}), the answer is: ${caseObj.expected.answer_contains ? caseObj.expected.answer_contains.slice(0, 3).join(", ") : "provided below."}`;

  return {
    answer: answerText,
    refused: false,
    sources: sourceIds.map((id, i) => ({
      source_id: id,
      location: sourceLocations[i] || sourceLocations[0] || "unknown",
    })),
  };
}

/* ──────────────────────────────────────────────
   Scoring
   ────────────────────────────────────────────── */
function scoreResponse(caseObj, response) {
  const rubric = caseObj.rubric;
  let score = 0;
  const details = [];

  // 1. Refusal check
  if (caseObj.expected.refused !== response.refused) {
    details.push(`FAIL: expected refused=${caseObj.expected.refused}, got ${response.refused}`);
  } else {
    score += rubric.criteria.find((c) => c.description.includes("Refuse") || c.description.includes("refuse"))?.weight || 1;
    details.push(`PASS: refusal correct (${response.refused})`);
  }

  if (response.refused) {
    return { score, max_score: rubric.max_score, details, passed: score > 0 };
  }

  // 2. Answer content check
  if (caseObj.expected.answer_contains && caseObj.expected.answer_contains.length > 0) {
    const lowerAnswer = (response.answer || "").toLowerCase();
    const matched = caseObj.expected.answer_contains.filter((term) =>
      lowerAnswer.includes(term.toLowerCase())
    );
    if (matched.length > 0) {
      score += 1;
      details.push(`PASS: answer contains expected terms (${matched.length}/${caseObj.expected.answer_contains.length})`);
    } else {
      details.push(`FAIL: answer missing any of: ${caseObj.expected.answer_contains.join(", ")}`);
    }
  }

  // 3. Source presence check
  if (caseObj.expected.source_ids && caseObj.expected.source_ids.length > 0) {
    const responseSourceIds = (response.sources || []).map((s) => s.source_id);
    const matchedSources = caseObj.expected.source_ids.filter((id) => responseSourceIds.includes(id));
    if (matchedSources.length > 0) {
      score += 1;
      details.push(`PASS: sources include ${matchedSources.length}/${caseObj.expected.source_ids.length} expected IDs`);
    } else {
      details.push(`FAIL: no expected source IDs found among: ${responseSourceIds.join(", ")}`);
    }
  }

  // 4. Anti-hallucination: no hallucinated sources outside curriculum
  const validSourcePrefixes = ["ch1-", "ch2-", "ch3-", "ch4-"];
  const hallucinated = (response.sources || []).filter(
    (s) => !validSourcePrefixes.some((p) => s.source_id.startsWith(p))
  );
  if (hallucinated.length > 0) {
    details.push(`WARN: ${hallucinated.length} source(s) outside known curriculum prefixes: ${hallucinated.map((s) => s.source_id).join(", ")}`);
  }

  // 5. Conflicts check
  if (caseObj.expected.conflicting_source_ids) {
    const responseIds = (response.sources || []).map((s) => s.source_id);
    const conflicts = caseObj.expected.conflicting_source_ids.filter((id) => responseIds.includes(id));
    if (conflicts.length > 0) {
      details.push(`FAIL: cited conflicting sources: ${conflicts.join(", ")}`);
    } else {
      details.push(`PASS: no conflicting sources cited`);
    }
  }

  return { score, max_score: rubric.max_score, details, passed: score >= Math.ceil(rubric.max_score / 2) };
}

/* ──────────────────────────────────────────────
   Main
   ────────────────────────────────────────────── */
function main() {
  const args = process.argv.slice(2);
  const modeIndex = args.indexOf("--mode");
  const mode = modeIndex !== -1 ? args[modeIndex + 1] : "mock";
  const agentOutputsIndex = args.indexOf("--agent-outputs");
  const agentOutputsPath = agentOutputsIndex !== -1 ? args[agentOutputsIndex + 1] : null;

  const datasetPath = resolve(__dirname, "grounded-v1.jsonl");
  const lines = readFileSync(datasetPath, "utf-8").split("\n").filter((l) => l.trim());

  console.log(`Evaluation mode: ${mode}`);
  console.log(`Dataset: ${lines.length} cases\n`);

  let agentResponses = null;
  if (mode === "real") {
    if (!agentOutputsPath) {
      console.error("ERROR: --mode real requires --agent-outputs <path>");
      process.exit(1);
    }
    agentResponses = JSON.parse(readFileSync(resolve(agentOutputsPath), "utf-8"));
  }

  const results = [];
  let passed = 0;
  let failed = 0;
  let notRun = 0;

  for (const line of lines) {
    const caseObj = JSON.parse(line);
    const response = agentResponses
      ? agentResponses.find((r) => r.id === caseObj.id)
      : buildMockResponse(caseObj);

    if (!response) {
      results.push({ id: caseObj.id, status: "NOT_RUN", reason: "No response available" });
      notRun++;
      continue;
    }

    const result = scoreResponse(caseObj, response);
    const status = result.passed ? "PASS" : "FAIL";
    results.push({ id: caseObj.id, category: caseObj.category, status, ...result });

    if (result.passed) passed++;
    else failed++;
  }

  /* Summary */
  console.log("=".repeat(60));
  console.log("  EVALUATION RESULTS");
  console.log("=".repeat(60));

  for (const r of results) {
    const icon = r.status === "PASS" ? "✅" : r.status === "FAIL" ? "❌" : "⏭️";
    console.log(`  ${icon} ${r.id} (${r.category || "?"}): ${r.status}`);
    for (const d of (r.details || [])) {
      const dIcon = d.startsWith("PASS") ? "  ✅" : d.startsWith("FAIL") ? "  ❌" : "  ⚠️";
      console.log(`  ${dIcon} ${d}`);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log(`  TOTAL:   ${results.length}`);
  console.log(`  PASS:    ${passed}`);
  console.log(`  FAIL:    ${failed}`);
  console.log(`  NOT RUN: ${notRun}`);
  console.log("=".repeat(60));

  /* Output machine-readable JSON */
  const report = {
    mode,
    dataset: "grounded-v1.jsonl",
    total: results.length,
    passed,
    failed,
    not_run: notRun,
    results,
    timestamp: new Date().toISOString(),
  };

  const reportPath = resolve(__dirname, `evaluation-report-${mode}.json`);
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nReport written to: ${reportPath}`);

  process.exit(failed > 0 ? 1 : 0);
}

main();

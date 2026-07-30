#!/usr/bin/env node

/**
 * validate-dataset.mjs — Deterministic schema validation for grounded-v1.jsonl
 *
 * Validates every case against a stable schema, checks for required fields,
 * correct categories, and rubric structure. Exits 0 if all cases pass, 1 otherwise.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const VALID_CATEGORIES = [
  "answerable_source_grounded",
  "absent_from_books_must_refuse",
  "wrong_missing_citation",
  "duplicate_conflicting_sources",
  "overlap_prerequisite",
  "malformed_structured_output",
  "direct_prompt_injection",
  "indirect_prompt_injection",
  "arabic_sample",
  "question_provenance_trusted_grading",
];

const REQUIRED_CASE_FIELDS = ["id", "category", "input", "expected", "rubric"];
const REQUIRED_EXPECTED_FIELDS = ["refused"];
const REQUIRED_RUBRIC_FIELDS = ["max_score", "criteria"];

let passed = 0;
let failed = 0;
const errors = [];
const seenIds = new Set();

function validateCase(caseObj, lineNum) {
  const label = `line ${lineNum} (id: ${caseObj.id || "MISSING"})`;

  for (const field of REQUIRED_CASE_FIELDS) {
    if (!(field in caseObj)) {
      errors.push(`${label}: missing required field "${field}"`);
      return false;
    }
  }

  if (typeof caseObj.id !== "string" || caseObj.id.length === 0) {
    errors.push(`${label}: "id" must be a non-empty string`);
    return false;
  }
  if (seenIds.has(caseObj.id)) {
    errors.push(`${label}: duplicate case ID`);
    return false;
  }
  seenIds.add(caseObj.id);

  if (!VALID_CATEGORIES.includes(caseObj.category)) {
    errors.push(`${label}: invalid category "${caseObj.category}". Valid: ${VALID_CATEGORIES.join(", ")}`);
    return false;
  }

  if (typeof caseObj.input !== "string" || caseObj.input.length === 0) {
    errors.push(`${label}: "input" must be a non-empty string`);
    return false;
  }

  const exp = caseObj.expected;
  for (const field of REQUIRED_EXPECTED_FIELDS) {
    if (!(field in exp)) {
      errors.push(`${label}: expected missing required field "${field}"`);
      return false;
    }
  }

  if (typeof exp.refused !== "boolean") {
    errors.push(`${label}: expected.refused must be boolean`);
    return false;
  }

  for (const field of ["answer_contains", "source_ids", "source_locations"]) {
    if (
      field in exp &&
      (!Array.isArray(exp[field]) ||
        exp[field].some((value) => typeof value !== "string" || !value.trim()))
    ) {
      errors.push(`${label}: expected.${field} must be an array of non-empty strings`);
      return false;
    }
  }

  if (exp.refused && (exp.source_ids?.length || exp.source_locations?.length)) {
    errors.push(`${label}: refused cases cannot expect citations`);
    return false;
  }
  if (
    ["answerable_source_grounded", "wrong_missing_citation", "arabic_sample"].includes(
      caseObj.category,
    ) &&
    (!exp.source_ids?.length || !exp.source_locations?.length)
  ) {
    errors.push(`${label}: grounded cases require expected source IDs and locations`);
    return false;
  }

  const rub = caseObj.rubric;
  for (const field of REQUIRED_RUBRIC_FIELDS) {
    if (!(field in rub)) {
      errors.push(`${label}: rubric missing required field "${field}"`);
      return false;
    }
  }

  if (typeof rub.max_score !== "number" || rub.max_score <= 0) {
    errors.push(`${label}: rubric.max_score must be a positive number`);
    return false;
  }

  if (!Array.isArray(rub.criteria) || rub.criteria.length === 0) {
    errors.push(`${label}: rubric.criteria must be a non-empty array`);
    return false;
  }

  for (let i = 0; i < rub.criteria.length; i++) {
    const c = rub.criteria[i];
    if (!c.description || typeof c.description !== "string") {
      errors.push(`${label}: rubric.criteria[${i}] missing "description"`);
      return false;
    }
    if (typeof c.weight !== "number" || c.weight <= 0) {
      errors.push(`${label}: rubric.criteria[${i}] must have positive "weight"`);
      return false;
    }
  }
  const totalWeight = rub.criteria.reduce((total, criterion) => total + criterion.weight, 0);
  if (totalWeight !== rub.max_score) {
    errors.push(
      `${label}: rubric criteria weights (${totalWeight}) must equal max_score (${rub.max_score})`,
    );
    return false;
  }

  return true;
}

function main() {
  const datasetPath = resolve(__dirname, "grounded-v1.jsonl");
  const lines = readFileSync(datasetPath, "utf-8").split("\n").filter((l) => l.trim());

  console.log(`Dataset: ${datasetPath}`);
  console.log(`Total lines (non-empty): ${lines.length}`);

  if (lines.length < 50) {
    errors.push(`Dataset has ${lines.length} cases, minimum required is 50`);
    failed++;
  }

  for (let i = 0; i < lines.length; i++) {
    let parsed;
    try {
      parsed = JSON.parse(lines[i]);
    } catch (err) {
      errors.push(`line ${i + 1}: invalid JSON — ${err.message}`);
      failed++;
      continue;
    }

    if (validateCase(parsed, i + 1)) {
      passed++;
    } else {
      failed++;
    }
  }

  console.log(`\nResults:`);
  console.log(`  Valid:   ${passed}`);
  console.log(`  Invalid: ${failed}`);

  if (errors.length > 0) {
    console.log(`\nErrors:`);
    for (const err of errors) {
      console.log(`  ❌ ${err}`);
    }
    process.exit(1);
  }

  const categories = new Set(lines.map((l) => JSON.parse(l).category));
  for (const category of VALID_CATEGORIES) {
    if (!categories.has(category)) errors.push(`Dataset is missing category "${category}"`);
  }
  if (errors.length) {
    for (const error of errors) console.log(`  ❌ ${error}`);
    process.exit(1);
  }
  console.log(`\nCategories covered (${categories.size}):`);
  for (const cat of [...categories].sort()) {
    console.log(`  ✓ ${cat}`);
  }

  console.log(`\n✅ All ${passed} cases pass schema validation.`);
}

main();

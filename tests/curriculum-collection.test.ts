import assert from "node:assert/strict";
import test from "node:test";
import { Curriculum } from "../src/models/Curriculum";

test("curriculum model shares the app's curricula collection", () => {
  assert.equal(Curriculum.collection.name, "curricula");
});

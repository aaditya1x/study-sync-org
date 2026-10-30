import test from "node:test";
import assert from "node:assert/strict";
import { validateAcademicProfile } from "../src/lib/academicProfileValidation.js";

const degrees = [{ id: "degree-a" }, { id: "degree-b" }];
const branches = [
  { id: "branch-a", degree_id: "degree-a" },
  { id: "branch-b", degree_id: "degree-b" },
];

test("requires a degree and branch", () => {
  assert.match(validateAcademicProfile({ degrees, branches }), /degree and a branch/);
  assert.match(validateAcademicProfile({ degreeId: "degree-a", degrees, branches }), /degree and a branch/);
});

test("rejects a degree that is not in the loaded catalog", () => {
  assert.match(
    validateAcademicProfile({ degreeId: "unknown", branchId: "branch-a", degrees, branches }),
    /valid degree/,
  );
});

test("rejects an unknown branch or a branch belonging to another degree", () => {
  assert.match(
    validateAcademicProfile({ degreeId: "degree-a", branchId: "unknown", degrees, branches }),
    /belongs to the selected degree/,
  );
  assert.match(
    validateAcademicProfile({ degreeId: "degree-a", branchId: "branch-b", degrees, branches }),
    /belongs to the selected degree/,
  );
});

test("accepts a branch belonging to the selected degree", () => {
  assert.equal(
    validateAcademicProfile({ degreeId: "degree-a", branchId: "branch-a", degrees, branches }),
    null,
  );
});

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  changeset,
  validateRequired,
  validateLength,
  validateFormat,
  validateInclusion,
  validateNumber,
  uniqueConstraint,
  putChange,
  getChange,
  applyChanges,
} from "../src/ember/changeset.js";

describe("changeset", () => {
  it("casts only allowed fields", () => {
    const cs = changeset({}, { name: "Alice", age: 30, admin: true }, ["name", "age"]);
    assert.deepEqual(cs.changes, { name: "Alice", age: 30 });
    assert.equal(cs.valid, true);
  });

  it("skips unchanged values", () => {
    const cs = changeset({ name: "Alice" }, { name: "Alice" }, ["name"]);
    assert.deepEqual(cs.changes, {});
  });
});

describe("validateRequired", () => {
  it("fails for blank fields", () => {
    const cs = changeset({}, {}, ["name"]);
    validateRequired(cs, ["name"]);
    assert.equal(cs.valid, false);
    assert.ok(cs.errors.name?.includes("can't be blank"));
  });

  it("passes for present fields", () => {
    const cs = changeset({}, { name: "Alice" }, ["name"]);
    validateRequired(cs, ["name"]);
    assert.equal(cs.valid, true);
  });
});

describe("validateLength", () => {
  it("validates min length", () => {
    const cs = changeset({}, { name: "A" }, ["name"]);
    validateLength(cs, "name", { min: 2 });
    assert.equal(cs.valid, false);
  });

  it("validates max length", () => {
    const cs = changeset({}, { name: "Alice" }, ["name"]);
    validateLength(cs, "name", { max: 3 });
    assert.equal(cs.valid, false);
  });

  it("passes for valid length", () => {
    const cs = changeset({}, { name: "Alice" }, ["name"]);
    validateLength(cs, "name", { min: 2, max: 10 });
    assert.equal(cs.valid, true);
  });
});

describe("validateFormat", () => {
  it("fails for invalid format", () => {
    const cs = changeset({}, { email: "nope" }, ["email"]);
    validateFormat(cs, "email", /@/);
    assert.equal(cs.valid, false);
  });

  it("passes for valid format", () => {
    const cs = changeset({}, { email: "a@b.com" }, ["email"]);
    validateFormat(cs, "email", /@/);
    assert.equal(cs.valid, true);
  });
});

describe("validateInclusion", () => {
  it("fails for invalid value", () => {
    const cs = changeset({}, { role: "god" }, ["role"]);
    validateInclusion(cs, "role", ["admin", "user"]);
    assert.equal(cs.valid, false);
  });
});

describe("validateNumber", () => {
  it("validates greaterThan", () => {
    const cs = changeset({}, { age: 0 }, ["age"]);
    validateNumber(cs, "age", { greaterThan: 0 });
    assert.equal(cs.valid, false);
  });

  it("passes for valid number", () => {
    const cs = changeset({}, { age: 18 }, ["age"]);
    validateNumber(cs, "age", { greaterThanOrEqual: 18 });
    assert.equal(cs.valid, true);
  });
});

describe("uniqueConstraint", () => {
  it("adds constraint metadata", () => {
    const cs = changeset({}, { email: "a@b.com" }, ["email"]);
    uniqueConstraint(cs, "email");
    assert.equal(cs.constraints.length, 1);
    assert.equal(cs.constraints[0].field, "email");
  });
});

describe("putChange / getChange / applyChanges", () => {
  it("puts and gets changes", () => {
    const cs = changeset({ name: "Alice" }, {}, []);
    putChange(cs, "name", "Bob");
    assert.equal(getChange(cs, "name"), "Bob");
  });

  it("applies changes to data", () => {
    const cs = changeset({ name: "Alice", age: 30 }, { name: "Bob" }, ["name"]);
    const result = applyChanges(cs);
    assert.equal(result.name, "Bob");
    assert.equal(result.age, 30);
  });
});

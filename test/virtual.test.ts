import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { defineVirtuals, applyVirtual, applyVirtuals } from "../src/ember/virtual.js";

interface User {
  firstName: string;
  lastName: string;
  age: number;
  email: string;
}

const userVirtuals = defineVirtuals<User>({
  fullName: (u) => `${u.firstName} ${u.lastName}`,
  isAdult: (u) => u.age >= 18,
  initials: (u) => `${u.firstName[0]}${u.lastName[0]}`.toUpperCase(),
  domain: (u) => u.email.split("@")[1],
});

const alice: User = { firstName: "Alice", lastName: "Smith", age: 30, email: "alice@example.com" };
const bob: User = { firstName: "Bob", lastName: "Jones", age: 16, email: "bob@school.edu" };

describe("defineVirtuals", () => {
  it("returns the virtual map", () => {
    assert.equal(typeof userVirtuals.fullName, "function");
    assert.equal(typeof userVirtuals.isAdult, "function");
  });
});

describe("applyVirtual", () => {
  it("adds virtual fields to a single record", () => {
    const result = applyVirtual(alice, userVirtuals);
    assert.equal(result.fullName, "Alice Smith");
    assert.equal(result.isAdult, true);
    assert.equal(result.initials, "AS");
    assert.equal(result.domain, "example.com");
  });

  it("preserves original fields", () => {
    const result = applyVirtual(alice, userVirtuals);
    assert.equal(result.firstName, "Alice");
    assert.equal(result.age, 30);
  });

  it("does not mutate the original record", () => {
    const original = { ...alice };
    applyVirtual(alice, userVirtuals);
    assert.deepEqual(alice, original);
  });

  it("handles falsy computed values", () => {
    const result = applyVirtual(bob, userVirtuals);
    assert.equal(result.isAdult, false);
  });
});

describe("applyVirtuals", () => {
  it("applies to an array of records", () => {
    const results = applyVirtuals([alice, bob], userVirtuals);
    assert.equal(results.length, 2);
    assert.equal(results[0].fullName, "Alice Smith");
    assert.equal(results[1].fullName, "Bob Jones");
    assert.equal(results[0].isAdult, true);
    assert.equal(results[1].isAdult, false);
  });

  it("handles empty array", () => {
    const results = applyVirtuals([], userVirtuals);
    assert.deepEqual(results, []);
  });
});

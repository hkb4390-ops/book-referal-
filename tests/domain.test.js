import test from "node:test";
import assert from "node:assert/strict";
import { PDFS, unlockedCount, tokenHash, isEligibleMember } from "../domain.js";

test("PDF reward thresholds are capped at nine",()=>{
  assert.equal(unlockedCount(0),0); assert.equal(unlockedCount(1),1);
  assert.equal(unlockedCount(2),2); assert.equal(unlockedCount(5),5);
  assert.equal(unlockedCount(9),9); assert.equal(unlockedCount(10),9);
  assert.equal(PDFS[0].subject,"Economics"); assert.equal(PDFS[1].subject,"Physics");
});
test("token hashing is deterministic without exposing raw token",()=>{
  assert.equal(tokenHash("abc"),tokenHash("abc")); assert.notEqual(tokenHash("abc"),"abc");
});
test("membership statuses are conservative",()=>{
  assert.equal(isEligibleMember({status:"member"}),true);
  assert.equal(isEligibleMember({status:"creator"}),true);
  assert.equal(isEligibleMember({status:"restricted",is_member:true}),true);
  assert.equal(isEligibleMember({status:"restricted",is_member:false}),false);
  assert.equal(isEligibleMember({status:"left"}),false);
  assert.equal(isEligibleMember({status:"kicked"}),false);
});

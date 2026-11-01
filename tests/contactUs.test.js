import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/components/ContactUs/ContactUs.jsx", import.meta.url), "utf8");

test("Contact Us submit prevents submission and shows the requested success message without sending", () => {
  assert.match(source, /function submit\(event\)\s*\{\s*event\.preventDefault\(\);/);
  assert.match(source, /state: "success", message: "O bhai! 😂 Call kar le mere pe, bagal mein hi number hai\. Message karne ke paise lagte hain! 😭"/);
  assert.doesNotMatch(source, /sendContactMessage|fetch\s*\(/);
  assert.match(source, /<form className=\{styles\.form\} onSubmit=\{submit\}>/);
  assert.match(source, /role=\{status\.state === "success" \? "status" : "alert"\}/);
});

test("Contact Us keeps the form fields and Call Admin and Email Admin actions", () => {
  for (const field of ["name", "email", "subject", "message"]) {
    assert.match(source, new RegExp(`name="${field}"`));
  }
  assert.match(source, /href="tel:9304459942"[^>]*>.*?Call Admin/s);
  assert.match(source, /href="mailto:aaditya002@yahoo\.com"[^>]*>.*?Email Admin/s);
});

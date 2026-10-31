import { describe, expect, test } from "bun:test";
import { redact, REDACTION_PATTERNS } from "../server/redact";

// Synthetic, obviously fake values only.
const CASES: [string, string][] = [
  ["linear api key", "key lin_api_FAKE0000000000000000 here"],
  ["linear oauth", "tok lin_oauth_FAKE000000000000 end"],
  ["slack xoxb", "xoxb-0000-FAKE-fake"],
  ["slack xoxp", "xoxp-1111-FAKE"],
  ["slack xoxa", "xoxa-2-FAKE"],
  ["slack xoxo", "xoxo-FAKE"],
  ["slack xoxs", "xoxs-FAKE-1"],
  ["slack xoxr", "xoxr-FAKE-2"],
  ["openai sk", "sk-FAKEFAKEFAKE1234"],
  ["anthropic sk-ant", "sk-ant-FAKE-abc"],
  ["github ghp", "ghp_FAKE000000"],
  ["github gho", "gho_FAKE"],
  ["github ghu", "ghu_FAKE"],
  ["github ghs", "ghs_FAKE"],
  ["github ghr", "ghr_FAKE"],
  ["bearer", "Authorization: Bearer FAKE.jwt.value"],
  ["token=", "token=FAKEVALUE"],
  ["secret:", "Secret: FAKEVALUE"],
  ["password=", "PASSWORD=FAKEVALUE"],
  ["api_key=", "api_key=FAKEVALUE"],
  ["api-key:", "API-KEY: FAKEVALUE"],
  ["apikey=", "apikey=FAKEVALUE"],
];

describe("redact", () => {
  for (const [name, input] of CASES) {
    test(`masks ${name}`, () => {
      const out = redact(input);
      expect(out).toContain("[REDACTED]");
      expect(out).not.toMatch(/FAKE/);
    });
  }
  test("every pattern is exercised by a case", () => {
    for (const re of REDACTION_PATTERNS) {
      const hit = CASES.some(([, s]) => new RegExp(re.source, re.flags.replace("g", "")).test(s));
      expect(hit).toBe(true);
    }
  });
  test("short sk- strings and plain text untouched", () => {
    expect(redact("risk-free task")).toBe("risk-free task");
    expect(redact("sk-short")).toBe("sk-short");
  });
  test("non-strings are stringified then redacted", () => {
    expect(redact({ msg: "token=FAKEVALUE" })).not.toContain("FAKEVALUE");
    expect(redact(null)).toBe("");
  });
});

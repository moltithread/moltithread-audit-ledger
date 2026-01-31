import test from "node:test";
import assert from "node:assert/strict";
import {
  redactObject,
  redactString,
  redactValue,
  containsSecrets,
  isSensitiveKey,
  findSensitivePatterns,
  RedactionError,
} from "../dist/redact.js";

// ==================== Key detection tests ====================

test("isSensitiveKey detects common sensitive key names", () => {
  const sensitiveKeys = [
    "token",
    "api_key",
    "apiKey",
    "API_KEY",
    "password",
    "secret",
    "auth_token",
    "authToken",
    "access_token",
    "ct0",
    "private_key",
    "authorization",
    "client_secret",
  ];

  for (const key of sensitiveKeys) {
    assert.ok(isSensitiveKey(key), `Expected "${key}" to be sensitive`);
  }
});

test("isSensitiveKey allows non-sensitive keys", () => {
  const safeKeys = [
    "name",
    "email",
    "user_id",
    "filename",
    "action",
    "summary",
    "type",
    "tokenCount", // word contains "token" but key isn't token
    "description",
  ];

  for (const key of safeKeys) {
    assert.ok(!isSensitiveKey(key), `Expected "${key}" to be non-sensitive`);
  }
});

// ==================== Value pattern tests ====================

test("findSensitivePatterns detects Bearer tokens", () => {
  const value = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
  const matches = findSensitivePatterns(value);
  assert.ok(matches.length > 0, "Should detect Bearer token");
});

test("findSensitivePatterns detects JWT tokens", () => {
  const jwt =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
  const matches = findSensitivePatterns(jwt);
  assert.ok(matches.length > 0, "Should detect JWT token");
});

test("findSensitivePatterns detects AWS access keys", () => {
  const value = "aws_access_key_id = AKIAIOSFODNN7EXAMPLE";
  const matches = findSensitivePatterns(value);
  assert.ok(matches.length > 0, "Should detect AWS access key");
});

test("findSensitivePatterns detects GitHub tokens", () => {
  const tokens = [
    "ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789",
    "gho_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789",
  ];

  for (const token of tokens) {
    const matches = findSensitivePatterns(token);
    assert.ok(matches.length > 0, `Should detect GitHub token: ${token.slice(0, 10)}...`);
  }
});

test("findSensitivePatterns detects Stripe keys", () => {
  // Construct test keys programmatically to avoid triggering GitHub secret scanner
  // Format: (sk|pk)_(live|test)_[24+ alphanumeric chars]
  const prefix1 = ["sk", "live"].join("_") + "_";
  const prefix2 = ["pk", "test"].join("_") + "_";
  const suffix = "X".repeat(24);

  const keys = [prefix1 + suffix, prefix2 + suffix];

  for (const key of keys) {
    const matches = findSensitivePatterns(key);
    assert.ok(matches.length > 0, `Should detect Stripe key: ${key.slice(0, 10)}...`);
  }
});

test("findSensitivePatterns detects private key headers", () => {
  const pemStart = "-----BEGIN RSA PRIVATE KEY-----";
  const matches = findSensitivePatterns(pemStart);
  assert.ok(matches.length > 0, "Should detect PEM private key header");
});

test("findSensitivePatterns detects long hex strings", () => {
  // 64-char hex string (like SHA256)
  const hex =
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  const matches = findSensitivePatterns(hex);
  assert.ok(matches.length > 0, "Should detect long hex string");
});

test("findSensitivePatterns detects inline key=value secrets", () => {
  const patterns = [
    "Set password=mysecret123",
    "Using token=abc123xyz456",
    "api_key: sk-12345678",
    'secret="hidden-value"',
    "auth_token=bearer123abc",
  ];

  for (const pattern of patterns) {
    const matches = findSensitivePatterns(pattern);
    assert.ok(matches.length > 0, `Should detect inline secret in: ${pattern}`);
  }
});

test("findSensitivePatterns ignores short safe strings", () => {
  const safeValues = [
    "hello world",
    "user@example.com",
    "12345",
    "file.txt",
    "/path/to/file",
    "https://example.com/page",
  ];

  for (const value of safeValues) {
    const matches = findSensitivePatterns(value);
    assert.equal(matches.length, 0, `Should not flag "${value}" as sensitive`);
  }
});

// ==================== redactValue tests ====================

test("redactValue replaces Bearer tokens", () => {
  const input = "Header: Bearer abc123xyz456def789ghi012jkl345mno";
  const result = redactValue(input);
  assert.ok(!result.includes("abc123xyz"), "Should have redacted the token");
  assert.ok(result.includes("[REDACTED]"), "Should contain replacement text");
});

test("redactValue with custom replacement", () => {
  const input = "token: ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789";
  const result = redactValue(input, "***");
  assert.ok(result.includes("***"), "Should use custom replacement");
});

// ==================== redactObject tests ====================

test("redactObject redacts sensitive keys", () => {
  const obj = {
    username: "alice",
    password: "supersecret123",
    api_key: "sk-abc123",
  };

  const result = redactObject(obj);
  assert.equal(result.username, "alice");
  assert.equal(result.password, "[REDACTED]");
  assert.equal(result.api_key, "[REDACTED]");
});

test("redactObject handles nested objects", () => {
  const obj = {
    user: {
      name: "bob",
      credentials: {
        token: "mytoken123",
      },
    },
  };

  const result = redactObject(obj);
  assert.equal(result.user.name, "bob");
  assert.equal(result.user.credentials.token, "[REDACTED]");
});

test("redactObject handles arrays", () => {
  const obj = {
    items: [
      { name: "safe", secret: "hidden" },
      { name: "also safe", password: "pass123" },
    ],
  };

  const result = redactObject(obj);
  assert.equal(result.items[0].name, "safe");
  assert.equal(result.items[0].secret, "[REDACTED]");
  assert.equal(result.items[1].password, "[REDACTED]");
});

test("redactObject redacts sensitive patterns in string values", () => {
  const obj = {
    logs: "Called API with Bearer abc123xyz456def789ghi012jkl345mno678",
  };

  const result = redactObject(obj);
  assert.ok(!result.logs.includes("abc123xyz"), "Should redact bearer token in string");
});

test("redactObject strict mode throws on secrets", () => {
  const obj = {
    password: "secret123",
  };

  assert.throws(
    () => redactObject(obj, { mode: "strict" }),
    RedactionError,
    "Should throw RedactionError in strict mode"
  );
});

test("redactObject strict mode provides match details", () => {
  const obj = {
    api_key: "mykey",
    data: "ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789",
  };

  try {
    redactObject(obj, { mode: "strict" });
    assert.fail("Should have thrown");
  } catch (e) {
    assert.ok(e instanceof RedactionError);
    assert.ok(e.matches.length >= 2, "Should report multiple matches");
  }
});

test("redactObject preserves non-sensitive data", () => {
  const obj = {
    id: "12345",
    name: "Test Entry",
    count: 42,
    active: true,
    tags: ["a", "b", "c"],
    nested: { foo: "bar" },
  };

  const result = redactObject(obj);
  assert.deepEqual(result, obj, "Should not modify safe data");
});

// ==================== redactString tests ====================

test("redactString handles plain strings", () => {
  const clean = "Hello world";
  assert.equal(redactString(clean), clean);

  const dirty = "Token: ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789";
  const result = redactString(dirty);
  assert.ok(result.includes("[REDACTED]"));
});

test("redactString strict mode throws", () => {
  // Construct test key programmatically to avoid triggering GitHub secret scanner
  const testKey = ["sk", "live"].join("_") + "_" + "X".repeat(24);
  assert.throws(
    () => redactString(testKey, { mode: "strict" }),
    RedactionError
  );
});

// ==================== containsSecrets tests ====================

test("containsSecrets returns true for objects with secrets", () => {
  assert.ok(containsSecrets({ password: "abc" }));
  assert.ok(containsSecrets({ data: "ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789" }));
});

test("containsSecrets returns false for clean objects", () => {
  assert.ok(!containsSecrets({ name: "alice", email: "a@b.com" }));
  assert.ok(!containsSecrets({ list: [1, 2, 3] }));
});

// ==================== Custom patterns tests ====================

test("redactObject accepts custom key patterns", () => {
  const obj = {
    myCustomSecret: "value123",
    normalField: "safe",
  };

  const result = redactObject(obj, {
    extraKeyPatterns: [/^myCustomSecret$/i],
  });

  assert.equal(result.myCustomSecret, "[REDACTED]");
  assert.equal(result.normalField, "safe");
});

test("redactObject accepts custom value patterns", () => {
  const obj = {
    data: "CUSTOM-SECRET-12345",
  };

  const result = redactObject(obj, {
    extraValuePatterns: [/CUSTOM-SECRET-\d+/],
  });

  assert.equal(result.data, "[REDACTED]");
});

// ==================== Edge cases ====================

test("redactObject handles null and undefined", () => {
  const obj = {
    a: null,
    b: undefined,
    c: "valid",
  };

  const result = redactObject(obj);
  assert.equal(result.a, null);
  assert.equal(result.b, undefined);
  assert.equal(result.c, "valid");
});

test("redactObject handles empty objects and arrays", () => {
  assert.deepEqual(redactObject({}), {});
  assert.deepEqual(redactObject([]), []);
  assert.deepEqual(redactObject({ items: [] }), { items: [] });
});

test("redactObject handles deeply nested structures", () => {
  const obj = {
    level1: {
      level2: {
        level3: {
          token: "secret",
        },
      },
    },
  };

  const result = redactObject(obj);
  assert.equal(result.level1.level2.level3.token, "[REDACTED]");
});

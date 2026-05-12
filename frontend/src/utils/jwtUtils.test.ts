import { describe, it, expect } from "vitest";
import {
  decodeJWTPayload,
  extractTenantFromSession,
  getCustomClaims,
} from "./jwtUtils";
import { makeJWT } from "../test/helpers";

// ---------------------------------------------------------------------------
// decodeJWTPayload
// ---------------------------------------------------------------------------

describe("decodeJWTPayload", () => {
  it("returns correct claims from a well-formed JWT", () => {
    const payload = {
      sub: "user-123",
      email: "user@example.com",
      tenant_id: "tenant-abc",
      exp: 9999999999,
      iat: 1000000000,
    };
    const token = makeJWT(payload);
    const claims = decodeJWTPayload(token);

    expect(claims).not.toBeNull();
    expect(claims!.sub).toBe("user-123");
    expect(claims!.email).toBe("user@example.com");
    expect(claims!.tenant_id).toBe("tenant-abc");
    expect(claims!.exp).toBe(9999999999);
  });

  it("returns null when token has fewer than 3 dot-separated parts", () => {
    expect(decodeJWTPayload("only.twoparts")).toBeNull();
    expect(decodeJWTPayload("noparts")).toBeNull();
    expect(decodeJWTPayload("")).toBeNull();
  });

  it("returns null when the payload is not valid JSON", () => {
    const badPayload = btoa("this is not json").replace(/=/g, "");
    const token = `header.${badPayload}.sig`;
    expect(decodeJWTPayload(token)).toBeNull();
  });

  it("handles base64 padding correctly when payload length % 4 !== 0", () => {
    // Craft a payload whose base64 length is NOT a multiple of 4
    const payload = { sub: "x" }; // short — likely to need padding
    const token = makeJWT(payload);
    const claims = decodeJWTPayload(token);
    expect(claims).not.toBeNull();
    expect(claims!.sub).toBe("x");
  });

  it("returns all fields present in the payload", () => {
    const payload = { sub: "u1", role: "admin", custom: "value" };
    const claims = decodeJWTPayload(makeJWT(payload));
    expect(claims!.role).toBe("admin");
    expect(claims!.custom).toBe("value");
  });
});

// ---------------------------------------------------------------------------
// extractTenantFromSession
// ---------------------------------------------------------------------------

describe("extractTenantFromSession", () => {
  it("returns tenant_id from JWT claims when present", () => {
    const token = makeJWT({ sub: "u1", tenant_id: "tenant-xyz" });
    const session = { access_token: token };
    expect(extractTenantFromSession(session)).toBe("tenant-xyz");
  });

  it("returns null when session is null", () => {
    expect(extractTenantFromSession(null)).toBeNull();
  });

  it("returns null when session.access_token is missing", () => {
    expect(extractTenantFromSession({ user: {} })).toBeNull();
    expect(extractTenantFromSession({})).toBeNull();
  });

  it("returns null when claims contain no tenant_id", () => {
    const token = makeJWT({ sub: "u1", email: "a@b.com" });
    expect(extractTenantFromSession({ access_token: token })).toBeNull();
  });

  it("returns null when access_token is malformed", () => {
    expect(
      extractTenantFromSession({ access_token: "not.a.validtoken" })
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getCustomClaims
// ---------------------------------------------------------------------------

describe("getCustomClaims", () => {
  it("returns custom fields, excluding all standard JWT claims", () => {
    const payload = {
      sub: "u1",
      exp: 9999999999,
      iat: 1000000000,
      iss: "https://auth.example.com",
      aud: "my-app",
      email: "u@e.com",
      role: "user",
      email_confirmed_at: "2024-01-01",
      // custom:
      tenant_id: "tenant-abc",
      org_name: "Acme",
    };
    const token = makeJWT(payload);
    const custom = getCustomClaims(token);

    // Standard claims must be excluded
    expect(custom).not.toHaveProperty("sub");
    expect(custom).not.toHaveProperty("exp");
    expect(custom).not.toHaveProperty("iat");
    expect(custom).not.toHaveProperty("iss");
    expect(custom).not.toHaveProperty("aud");
    expect(custom).not.toHaveProperty("email");
    expect(custom).not.toHaveProperty("role");
    expect(custom).not.toHaveProperty("email_confirmed_at");

    // Custom claims must be present
    expect(custom.tenant_id).toBe("tenant-abc");
    expect(custom.org_name).toBe("Acme");
  });

  it("returns an empty object when the token cannot be decoded", () => {
    expect(getCustomClaims("invalid-token")).toEqual({});
    expect(getCustomClaims("")).toEqual({});
  });

  it("returns empty object when payload has only standard claims", () => {
    const token = makeJWT({ sub: "u1", exp: 9999999999, iat: 0 });
    expect(getCustomClaims(token)).toEqual({});
  });
});

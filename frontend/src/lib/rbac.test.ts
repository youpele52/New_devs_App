import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createPermission,
  grantEmergencyAccess,
  getAccessLogs,
  checkPermission,
} from "./rbac";
import { makeQueryBuilder } from "../test/helpers";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("./supabase", () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

vi.mock("./logging", () => ({
  createLog: vi.fn().mockResolvedValue(null),
}));

import { supabase } from "./supabase";
import { createLog } from "./logging";

const mockFrom = vi.mocked(supabase.from);
const mockRpc = vi.mocked(supabase.rpc);

// ---------------------------------------------------------------------------
// createPermission
// ---------------------------------------------------------------------------

describe("createPermission", () => {
  it("inserts into the permissions table and returns the created record", async () => {
    const created = { id: "perm-1", name: "view_dashboard", section: "dashboard" };
    const qb = makeQueryBuilder({ data: created, error: null });
    mockFrom.mockReturnValue(qb as any);

    const result = await createPermission({ name: "view_dashboard", section: "dashboard" });

    expect(mockFrom).toHaveBeenCalledWith("permissions");
    expect(qb.insert).toHaveBeenCalledWith([
      expect.objectContaining({ name: "view_dashboard" }),
    ]);
    expect(result).toEqual(created);
  });

  it("calls createLog with action 'create' and section 'rbac' on success", async () => {
    const created = { id: "perm-2", name: "edit_users" };
    const qb = makeQueryBuilder({ data: created, error: null });
    mockFrom.mockReturnValue(qb as any);

    await createPermission({ name: "edit_users" });

    expect(createLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "create", section: "rbac" })
    );
  });

  it("throws when supabase returns an error", async () => {
    const qb = makeQueryBuilder({ data: null, error: new Error("DB error") });
    mockFrom.mockReturnValue(qb as any);

    await expect(
      createPermission({ name: "broken_perm" })
    ).rejects.toThrow("DB error");
  });
});

// ---------------------------------------------------------------------------
// grantEmergencyAccess
// ---------------------------------------------------------------------------

describe("grantEmergencyAccess", () => {
  const userId = "user-abc";
  const permissions = { properties: "read" };
  const reason = "Emergency maintenance access";
  const validUntil = "2030-01-01T00:00:00Z";

  it("inserts into emergency_access with correct fields", async () => {
    const created = { id: "ea-1", user_id: userId, reason, valid_until: validUntil };
    const qb = makeQueryBuilder({ data: created, error: null });
    mockFrom.mockReturnValue(qb as any);

    const result = await grantEmergencyAccess(userId, permissions, reason, validUntil);

    expect(mockFrom).toHaveBeenCalledWith("emergency_access");
    expect(qb.insert).toHaveBeenCalledWith([
      expect.objectContaining({
        user_id: userId,
        permissions,
        reason,
        valid_until: validUntil,
      }),
    ]);
    expect(result).toEqual(created);
  });

  it("calls createLog with action 'create' and entity type 'emergency_access'", async () => {
    const created = { id: "ea-2", user_id: userId };
    const qb = makeQueryBuilder({ data: created, error: null });
    mockFrom.mockReturnValue(qb as any);

    await grantEmergencyAccess(userId, permissions, reason, validUntil);

    expect(createLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "create", entity_type: "emergency_access" })
    );
  });

  it("throws on supabase error", async () => {
    const qb = makeQueryBuilder({ data: null, error: new Error("Insert failed") });
    mockFrom.mockReturnValue(qb as any);

    await expect(
      grantEmergencyAccess(userId, permissions, reason, validUntil)
    ).rejects.toThrow("Insert failed");
  });
});

// ---------------------------------------------------------------------------
// getAccessLogs
// ---------------------------------------------------------------------------

describe("getAccessLogs", () => {
  it("queries the access_logs table ordered by created_at descending", async () => {
    const logs = [{ id: "log-1", action: "read", user_id: "u1" }];
    const qb = makeQueryBuilder({ data: logs, error: null });
    mockFrom.mockReturnValue(qb as any);

    const result = await getAccessLogs({});

    expect(mockFrom).toHaveBeenCalledWith("access_logs");
    expect(qb.select).toHaveBeenCalledWith("*");
    expect(qb.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(result).toEqual(logs);
  });

  it("applies eq filter for userId when provided", async () => {
    const qb = makeQueryBuilder({ data: [], error: null });
    mockFrom.mockReturnValue(qb as any);

    await getAccessLogs({ userId: "user-123" });

    expect(qb.eq).toHaveBeenCalledWith("user_id", "user-123");
  });

  it("applies eq filter for action when provided", async () => {
    const qb = makeQueryBuilder({ data: [], error: null });
    mockFrom.mockReturnValue(qb as any);

    await getAccessLogs({ action: "delete" });

    expect(qb.eq).toHaveBeenCalledWith("action", "delete");
  });

  it("applies gte and lte for date range filters", async () => {
    const qb = makeQueryBuilder({ data: [], error: null });
    mockFrom.mockReturnValue(qb as any);

    await getAccessLogs({
      startDate: "2024-01-01",
      endDate: "2024-12-31",
    });

    expect(qb.gte).toHaveBeenCalledWith("created_at", "2024-01-01");
    expect(qb.lte).toHaveBeenCalledWith("created_at", "2024-12-31");
  });

  it("does NOT call eq when filter properties are undefined", async () => {
    const qb = makeQueryBuilder({ data: [], error: null });
    mockFrom.mockReturnValue(qb as any);

    await getAccessLogs({}); // no filters

    expect(qb.eq).not.toHaveBeenCalled();
    expect(qb.gte).not.toHaveBeenCalled();
    expect(qb.lte).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// checkPermission
// ---------------------------------------------------------------------------

describe("checkPermission", () => {
  it("calls supabase.rpc with the correct arguments and returns true on success", async () => {
    mockRpc.mockResolvedValue({ data: true, error: null } as any);

    const result = await checkPermission("view_properties", "property-1");

    expect(mockRpc).toHaveBeenCalledWith("check_user_permission", {
      p_permission_name: "view_properties",
      p_resource: "property-1",
    });
    expect(result).toBe(true);
  });

  it("returns false (does not throw) when supabase returns an error", async () => {
    mockRpc.mockResolvedValue({ data: null, error: new Error("RPC error") } as any);

    const result = await checkPermission("non_existent");
    expect(result).toBe(false);
  });
});

import type { ReliefAllocationCommand } from "@disaster/shared-types";
import { describe, expect, it, vi } from "vitest";

import { createHttpClient } from "./index";
import { createReliefAllocationClient } from "./relief";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const ITEM_ID = "22222222-2222-4222-8222-222222222222";
const IDEMPOTENCY_KEY = "33333333-3333-4333-8333-333333333333";
const DEV_USER_ID = "44444444-4444-4444-8444-444444444444";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("relief allocation API client", () => {
  it("lists the ranked queue with only explicitly frozen optional filters", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response([]));
    const client = createReliefAllocationClient(
      createHttpClient({ baseUrl: "http://localhost:4000/api/v1", fetchImpl }),
    );

    await expect(
      client.listReliefRequests({ status: "PARTIALLY_ALLOCATED", zoneSeverity: "CRITICAL" }),
    ).resolves.toEqual([]);

    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      "http://localhost:4000/api/v1/relief-requests?status=PARTIALLY_ALLOCATED&zoneSeverity=CRITICAL",
    );
    expect(fetchImpl.mock.calls[0]?.[1]?.method).toBe("GET");
  });

  it("gets the frozen relief-request details operation", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ requestId: REQUEST_ID, requestVersion: 1 }));
    const client = createReliefAllocationClient(
      createHttpClient({ baseUrl: "http://localhost:4000/api/v1", fetchImpl }),
    );

    await client.getReliefRequest(REQUEST_ID);

    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      `http://localhost:4000/api/v1/relief-requests/${REQUEST_ID}`,
    );
  });

  it("creates an allocation with typed JSON and an idempotency key", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ allocationId: "allocation-1" }, 201));
    const client = createReliefAllocationClient(
      createHttpClient({
        baseUrl: "http://localhost:4000/api/v1",
        fetchImpl,
        defaultHeaders: { "X-Dev-User-Id": DEV_USER_ID },
      }),
    );
    const command: ReliefAllocationCommand = {
      requestVersion: 4,
      items: [{ requestItemId: ITEM_ID, allocateQty: 8 }],
      shortages: [],
      notes: "Allocate available medical kits.",
    };

    await client.createReliefAllocation(REQUEST_ID, command, IDEMPOTENCY_KEY);

    const [url, options] = fetchImpl.mock.calls[0] ?? [];
    const headers = new Headers(options?.headers);
    expect(url).toBe(`http://localhost:4000/api/v1/relief-requests/${REQUEST_ID}/allocations`);
    expect(options?.method).toBe("POST");
    expect(options?.body).toBe(JSON.stringify(command));
    expect(headers.get("Idempotency-Key")).toBe(IDEMPOTENCY_KEY);
    expect(headers.get("X-Dev-User-Id")).toBe(DEV_USER_ID);
  });

  it("looks up the committed receipt by idempotency key", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ allocationId: "allocation-1" }));
    const client = createReliefAllocationClient(
      createHttpClient({ baseUrl: "http://localhost:4000/api/v1", fetchImpl }),
    );

    await client.getReliefAllocationByIdempotencyKey(IDEMPOTENCY_KEY);

    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      `http://localhost:4000/api/v1/allocations/by-idempotency-key/${IDEMPOTENCY_KEY}`,
    );
    expect(fetchImpl.mock.calls[0]?.[1]?.method).toBe("GET");
  });
});

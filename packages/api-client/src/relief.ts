import type {
  ReliefAllocationCommand,
  ReliefAllocationReceipt,
  ReliefAllocationReceiptLookupResponse,
  ReliefRequestDetails,
  ReliefRequestQueueQuery,
  ReliefRequestQueueResponse,
} from "@disaster/shared-types";

import type { HttpClient } from "./index.js";

type ReliefHttpClient = Pick<HttpClient, "get" | "post">;

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

export function createReliefAllocationClient(httpClient: ReliefHttpClient) {
  return {
    listReliefRequests(query: ReliefRequestQueueQuery = {}): Promise<ReliefRequestQueueResponse> {
      const search = new URLSearchParams();
      if (query.status) search.set("status", query.status);
      if (query.zoneSeverity) search.set("zoneSeverity", query.zoneSeverity);
      const queryString = search.toString();

      return httpClient.get<ReliefRequestQueueResponse>(
        `/relief-requests${queryString ? `?${queryString}` : ""}`,
      );
    },

    getReliefRequest(requestId: string): Promise<ReliefRequestDetails> {
      return httpClient.get<ReliefRequestDetails>(
        `/relief-requests/${encodePathSegment(requestId)}`,
      );
    },

    createReliefAllocation(
      requestId: string,
      command: ReliefAllocationCommand,
      idempotencyKey: string,
    ): Promise<ReliefAllocationReceipt> {
      return httpClient.post<ReliefAllocationReceipt, ReliefAllocationCommand>(
        `/relief-requests/${encodePathSegment(requestId)}/allocations`,
        {
          body: command,
          headers: { "Idempotency-Key": idempotencyKey },
        },
      );
    },

    getReliefAllocationByIdempotencyKey(
      key: string,
    ): Promise<ReliefAllocationReceiptLookupResponse> {
      return httpClient.get<ReliefAllocationReceiptLookupResponse>(
        `/allocations/by-idempotency-key/${encodePathSegment(key)}`,
      );
    },
  } as const;
}

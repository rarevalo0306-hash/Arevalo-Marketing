import { describe, expect, it } from "vitest";
import { isFalQueueUrl } from "@/lib/fal";

describe("isFalQueueUrl", () => {
  it("acepta solo la cola de fal.ai por https", () => {
    expect(isFalQueueUrl("https://queue.fal.run/fal-ai/kling-video/requests/abc/status")).toBe(true);
    expect(isFalQueueUrl("http://queue.fal.run/x")).toBe(false);
    expect(isFalQueueUrl("https://queue.fal.run.evil.com/x")).toBe(false);
    expect(isFalQueueUrl("https://example.com/?u=queue.fal.run")).toBe(false);
    expect(isFalQueueUrl("no es url")).toBe(false);
  });
});

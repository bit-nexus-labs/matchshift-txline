import { describe, expect, it } from "vitest";
import { DEMO_PAGE_HTML } from "../src/ui/demo-page.js";

describe("judge page product context", () => {
  it("restores the server-side proof footer and links the transparent update", () => {
    expect(DEMO_PAGE_HTML).toContain("No client-side hiding.");
    expect(DEMO_PAGE_HTML).toContain("01 · ingest");
    expect(DEMO_PAGE_HTML).toContain("05 · explain");
    expect(DEMO_PAGE_HTML).toContain("Consumer &amp; Fan Experience track");
    expect(DEMO_PAGE_HTML).toContain("Product update · July 21, 2026");
    expect(DEMO_PAGE_HTML).toContain(
      "docs/PRODUCT_UPDATE_2026-07-21.md"
    );
    expect(DEMO_PAGE_HTML).toContain("post-submission");
  });
});

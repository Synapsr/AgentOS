import { describe, expect, it } from "vitest";
import { fitWidth } from "../src/image.js";

describe("fitWidth", () => {
  it("keeps a capture that is narrow enough", () => {
    expect(fitWidth(1200, 800, 1568)).toEqual({ width: 1200, height: 800 });
    expect(fitWidth(3420, 2214)).toEqual({ width: 3420, height: 2214 });
  });

  it("scales a wide capture down, keeping its proportions", () => {
    expect(fitWidth(3420, 2214, 1568)).toEqual({ width: 1568, height: 1015 });
    expect(fitWidth(5000, 2, 100)).toEqual({ width: 100, height: 1 });
  });
});

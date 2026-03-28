import { describe, it, expect } from "vitest";
import { getDefaultVisiblePatches } from "../../components/FieldMeshRenderer";

describe("getDefaultVisiblePatches", () => {
  it("shows patches ending with 'Group', lowerwall, and symmetryPlane", () => {
    const patches = [
      { name: "motorBikeGroup" },
      { name: "lowerwall" },
      { name: "symmetryPlane" },
      { name: "inlet" },
      { name: "outlet" },
      { name: "upperWall" },
    ];

    const vis = getDefaultVisiblePatches(patches);

    expect(vis.motorBikeGroup).toBe(true);
    expect(vis.lowerwall).toBe(true);
    expect(vis.symmetryPlane).toBe(true);
    expect(vis.inlet).toBe(false);
    expect(vis.outlet).toBe(false);
    expect(vis.upperWall).toBe(false);
  });

  it("handles custom STL names with Group suffix", () => {
    const patches = [
      { name: "myPartGroup" },
      { name: "anotherObjectGroup" },
      { name: "lowerwall" },
      { name: "symmetryPlane" },
      { name: "inlet" },
    ];

    const vis = getDefaultVisiblePatches(patches);

    expect(vis.myPartGroup).toBe(true);
    expect(vis.anotherObjectGroup).toBe(true);
    expect(vis.lowerwall).toBe(true);
    expect(vis.symmetryPlane).toBe(true);
    expect(vis.inlet).toBe(false);
  });

  it("returns empty object for empty patches array", () => {
    const vis = getDefaultVisiblePatches([]);
    expect(vis).toEqual({});
  });

  it("shows everything as fallback if no recognized patches match", () => {
    const patches = [
      { name: "inlet" },
      { name: "outlet" },
      { name: "upperWall" },
    ];

    const vis = getDefaultVisiblePatches(patches);

    // Fallback: all visible when none match the default rules
    expect(vis.inlet).toBe(true);
    expect(vis.outlet).toBe(true);
    expect(vis.upperWall).toBe(true);
  });

  it("handles hyphenated and underscore STL names", () => {
    const patches = [
      { name: "my-cool-partGroup" },
      { name: "another_objectGroup" },
      { name: "lowerwall" },
    ];

    const vis = getDefaultVisiblePatches(patches);

    expect(vis["my-cool-partGroup"]).toBe(true);
    expect(vis["another_objectGroup"]).toBe(true);
  });

  it("matches case-insensitively (lowerWall, SymmetryPlane)", () => {
    const patches = [
      { name: "motorBikeGroup" },
      { name: "lowerWall" },
      { name: "SymmetryPlane" },
      { name: "inlet" },
    ];

    const vis = getDefaultVisiblePatches(patches);

    expect(vis.motorBikeGroup).toBe(true);
    expect(vis.lowerWall).toBe(true);
    expect(vis.SymmetryPlane).toBe(true);
    expect(vis.inlet).toBe(false);
  });
});

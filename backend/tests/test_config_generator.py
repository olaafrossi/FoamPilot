"""Tests for services.config_generator — STL parsing and OpenFOAM dict generation."""

from __future__ import annotations

import struct
from pathlib import Path

import pytest

from services.config_generator import (
    BoundingBox,
    GeometryEntry,
    MRFZoneConfig,
    generate_block_mesh_dict,
    generate_cylinder_stl,
    generate_mrf_properties,
    generate_snappy_hex_mesh_dict,
    generate_surface_feature_extract_dict,
    stl_bounds,
    transform_stl,
)


# ---------------------------------------------------------------------------
# STL bounding-box parsing
# ---------------------------------------------------------------------------


class TestStlBoundsBinary:
    def test_stl_bounds_binary(self, binary_stl_file):
        """Parse a 1-triangle binary STL and verify bounding box."""
        bb = stl_bounds(binary_stl_file)
        assert bb.num_triangles == 1
        assert bb.min_x == pytest.approx(0.0)
        assert bb.min_y == pytest.approx(0.0)
        assert bb.min_z == pytest.approx(0.0)
        assert bb.max_x == pytest.approx(1.0)
        assert bb.max_y == pytest.approx(1.0)
        assert bb.max_z == pytest.approx(0.0)

    def test_stl_bounds_size_properties(self, binary_stl_file):
        """Verify size_x, size_y, size_z properties."""
        bb = stl_bounds(binary_stl_file)
        assert bb.size_x == pytest.approx(1.0)
        assert bb.size_y == pytest.approx(1.0)
        assert bb.size_z == pytest.approx(0.0)

    def test_stl_bounds_center(self, binary_stl_file):
        """Verify center property."""
        bb = stl_bounds(binary_stl_file)
        assert bb.center == pytest.approx((0.5, 0.5, 0.0))


class TestStlBoundsAscii:
    def test_stl_bounds_ascii(self, ascii_stl_file):
        """Parse a 1-triangle ASCII STL and verify bounding box."""
        bb = stl_bounds(ascii_stl_file)
        assert bb.num_triangles == 1
        assert bb.min_x == pytest.approx(0.0)
        assert bb.min_y == pytest.approx(0.0)
        assert bb.min_z == pytest.approx(0.0)
        assert bb.max_x == pytest.approx(1.0)
        assert bb.max_y == pytest.approx(1.0)
        assert bb.max_z == pytest.approx(0.0)


class TestStlBoundsDegenerate:
    def test_stl_bounds_degenerate(self, degenerate_stl_file):
        """STL with all vertices at the same point yields degenerate bounds."""
        bb = stl_bounds(degenerate_stl_file)
        assert bb.num_triangles == 1
        assert bb.min_x == pytest.approx(5.0)
        assert bb.max_x == pytest.approx(5.0)
        assert bb.min_y == pytest.approx(5.0)
        assert bb.max_y == pytest.approx(5.0)
        assert bb.min_z == pytest.approx(5.0)
        assert bb.max_z == pytest.approx(5.0)
        # All sizes should be zero
        assert bb.size_x == pytest.approx(0.0)
        assert bb.size_y == pytest.approx(0.0)
        assert bb.size_z == pytest.approx(0.0)


class TestStlBoundsLargeGeometry:
    def test_stl_bounds_large_geometry(self, large_geometry_stl_file):
        """STL spanning (-100,-50,0) to (100,50,200)."""
        bb = stl_bounds(large_geometry_stl_file)
        assert bb.num_triangles == 1
        assert bb.min_x == pytest.approx(-100.0)
        assert bb.min_y == pytest.approx(-50.0)
        assert bb.min_z == pytest.approx(0.0)
        assert bb.max_x == pytest.approx(100.0)
        assert bb.max_y == pytest.approx(50.0)
        assert bb.max_z == pytest.approx(200.0)
        assert bb.size_x == pytest.approx(200.0)
        assert bb.size_y == pytest.approx(100.0)
        assert bb.size_z == pytest.approx(200.0)


# ---------------------------------------------------------------------------
# blockMeshDict generation
# ---------------------------------------------------------------------------


class TestGenerateBlockMeshDict:
    def _make_bbox(self, min_x=0, min_y=0, min_z=0, max_x=1, max_y=1, max_z=1):
        return BoundingBox(
            min_x=min_x, min_y=min_y, min_z=min_z,
            max_x=max_x, max_y=max_y, max_z=max_z,
            num_triangles=1,
        )

    def test_generate_block_mesh_dict(self):
        """Verify blockMeshDict contains FoamFile header, vertices, blocks, and correct sizing."""
        bbox = self._make_bbox(min_x=-1, min_y=-0.5, min_z=0, max_x=1, max_y=0.5, max_z=0.5)
        result = generate_block_mesh_dict([GeometryEntry(filename="car.stl", bbox=bbox)])

        # FoamFile header present
        assert "FoamFile" in result
        assert "blockMeshDict" in result
        assert "version     2.0" in result

        # Structural elements
        assert "vertices" in result
        assert "blocks" in result
        assert "boundary" in result
        assert "hex" in result
        assert "simpleGrading" in result

        # Domain sizing (symmetric half-domain):
        #   x_min = min(-1 - 5*2, -5) = -11
        #   x_max = max(1 + 15*2, 15) = 31
        #   y_min = 0 (symmetry plane)
        #   y_max = max(0.5 + 4*1, 4) = 4.5
        #   z_min = 0
        #   z_max = max(8*0.5, 8) = 8
        assert "-11" in result
        assert "31" in result
        assert "4.5" in result

        # Boundary patches — symmetric layout
        assert "symWall" in result
        assert "type symmetry;" in result
        assert "left" in result
        assert "inlet" in result
        assert "outlet" in result
        assert "lowerWall" in result
        assert "upperWall" in result
        # frontAndBack is no longer used
        assert "frontAndBack" not in result

    def test_generate_block_mesh_dict_small_geometry(self):
        """Geometry smaller than minimum domain, verify minimums enforced."""
        bbox = self._make_bbox(
            min_x=0, min_y=0, min_z=0,
            max_x=0.1, max_y=0.1, max_z=0.1,
        )
        result = generate_block_mesh_dict([GeometryEntry(filename="tiny.stl", bbox=bbox)])

        # With very small geometry, domain should clamp to minimums:
        # x_min = min(0 - 5*0.1, -5) = min(-0.5, -5) = -5
        # x_max = max(0.1 + 15*0.1, 15) = max(1.6, 15) = 15
        # y_min = 0 (symmetry plane)
        # y_max = max(0.1 + 4*0.1, 4) = max(0.5, 4) = 4
        # z_max = max(8*0.1, 8) = max(0.8, 8) = 8
        assert "-5" in result
        assert "15" in result
        # y_min is always 0 for symmetric domain
        assert "symWall" in result
        # z_max should be 8
        assert "8" in result

    def test_generate_block_mesh_dict_ground_vehicle(self):
        """Ground vehicle domain: z_min=0, lowerWall is wall type, Y=0 symmetry."""
        bbox = self._make_bbox(min_x=-1, min_y=-0.5, min_z=0, max_x=1, max_y=0.5, max_z=0.5)
        result = generate_block_mesh_dict([GeometryEntry(filename="car.stl", bbox=bbox)], domain_type="ground_vehicle")

        # z_min should be 0 (ground plane)
        assert "lowerWall" in result
        assert 'type wall;' in result
        # Y=0 symmetry plane
        assert "type symmetry;" in result

    def test_generate_block_mesh_dict_freestream(self):
        """Freestream domain: symmetric z, lowerWall is patch (not wall), Y=0 symmetry."""
        bbox = self._make_bbox(min_x=-0.5, min_y=-0.3, min_z=-0.1, max_x=0.5, max_y=0.3, max_z=0.2)
        result = generate_block_mesh_dict([GeometryEntry(filename="plane.stl", bbox=bbox)], domain_type="freestream")

        # lowerWall should be type patch, not wall
        assert "lowerWall" in result
        assert 'type patch;' in result.split("lowerWall")[1].split("}")[0]

        # z_min should be negative (symmetric domain in Z)
        # z_min = min(-0.1 - 4*0.3, -4) = min(-1.3, -4) = -4
        assert "-4" in result or "-1.3" in result

        # Y=0 symmetry plane should still be present
        assert "type symmetry;" in result


# ---------------------------------------------------------------------------
# snappyHexMeshDict generation
# ---------------------------------------------------------------------------


class TestGenerateSnappyHexMeshDict:
    def test_generate_snappy_hex_mesh_dict(self):
        """Verify snappyHexMeshDict references STL, has all required sections."""
        bbox = BoundingBox(
            min_x=0, min_y=-0.5, min_z=0,
            max_x=2, max_y=0.5, max_z=0.5,
            num_triangles=100,
        )
        result = generate_snappy_hex_mesh_dict([GeometryEntry(filename="car.stl", bbox=bbox)])

        # FoamFile header
        assert "FoamFile" in result
        assert "snappyHexMeshDict" in result

        # STL references
        assert "car.stl" in result
        assert "car" in result  # stem name used in refinementSurfaces
        assert "car.eMesh" in result  # feature edge mesh

        # Required sections
        assert "castellatedMesh true" in result
        assert "snap            true" in result
        assert "addLayers       true" in result
        assert "castellatedMeshControls" in result
        assert "snapControls" in result
        assert "addLayersControls" in result
        assert "meshQualityControls" in result

        # Geometry section
        assert "triSurfaceMesh" in result
        assert "refinementBox" in result

        # locationInMesh
        assert "locationInMesh" in result


# ---------------------------------------------------------------------------
# surfaceFeatureExtractDict generation
# ---------------------------------------------------------------------------


class TestGenerateSurfaceFeatureExtractDict:
    def test_generate_surface_feature_extract_dict(self):
        """Verify output references STL and has extractionMethod."""
        result = generate_surface_feature_extract_dict(["car.stl"])

        assert "FoamFile" in result
        assert "surfaceFeatureExtractDict" in result
        assert "car.stl" in result
        assert "extractFromSurface" in result
        assert "includedAngle" in result
        assert "subsetFeatures" in result


# ---------------------------------------------------------------------------
# STL transform (rotation / translation)
# ---------------------------------------------------------------------------


class TestTransformStlBinary:
    """Test rotation and translation on binary STL data."""

    def test_identity_transform(self, binary_stl_file):
        """No rotation or translation returns identical bytes."""
        raw = binary_stl_file.read_bytes()
        result = transform_stl(raw)
        assert result == raw

    def test_translate_z(self, binary_stl_file):
        """Translate vertices by +10 in Z; bounds should shift."""
        raw = binary_stl_file.read_bytes()
        transformed = transform_stl(raw, translate_z=10.0)

        # Write to temp file so stl_bounds can parse it
        out_path = binary_stl_file.parent / "shifted.stl"
        out_path.write_bytes(transformed)
        bb = stl_bounds(out_path)

        assert bb.min_z == pytest.approx(10.0)
        assert bb.max_z == pytest.approx(10.0)
        # X and Y should be unchanged
        assert bb.min_x == pytest.approx(0.0)
        assert bb.max_y == pytest.approx(1.0)

    def test_rotate_90_x(self, binary_stl_file):
        """Rotate 90° around X swaps Y→Z and Z→-Y.

        Original vertices: (0,0,0), (1,0,0), (0,1,0)
        After 90° X rotation: Y→Z, Z→-Y
        Expected: (0,0,0), (1,0,0), (0,0,1)
        """
        raw = binary_stl_file.read_bytes()
        transformed = transform_stl(raw, rotate_x=90.0)

        out_path = binary_stl_file.parent / "rotated.stl"
        out_path.write_bytes(transformed)
        bb = stl_bounds(out_path)

        assert bb.min_x == pytest.approx(0.0)
        assert bb.max_x == pytest.approx(1.0)
        assert bb.min_y == pytest.approx(0.0, abs=1e-5)
        assert bb.max_y == pytest.approx(0.0, abs=1e-5)
        assert bb.min_z == pytest.approx(0.0, abs=1e-5)
        assert bb.max_z == pytest.approx(1.0, abs=1e-5)

    def test_rotate_90_z(self, binary_stl_file):
        """Rotate 90° around Z swaps X→Y and Y→-X.

        Original vertices: (0,0,0), (1,0,0), (0,1,0)
        After 90° Z rotation: X→Y, Y→-X
        Expected: (0,0,0), (0,1,0), (-1,0,0)
        """
        raw = binary_stl_file.read_bytes()
        transformed = transform_stl(raw, rotate_z=90.0)

        out_path = binary_stl_file.parent / "rotated_z.stl"
        out_path.write_bytes(transformed)
        bb = stl_bounds(out_path)

        assert bb.min_x == pytest.approx(-1.0, abs=1e-5)
        assert bb.max_x == pytest.approx(0.0, abs=1e-5)
        assert bb.min_y == pytest.approx(0.0, abs=1e-5)
        assert bb.max_y == pytest.approx(1.0, abs=1e-5)

    def test_rotate_and_translate(self, binary_stl_file):
        """Combined rotation + translation."""
        raw = binary_stl_file.read_bytes()
        transformed = transform_stl(raw, rotate_x=90.0, translate_z=5.0)

        out_path = binary_stl_file.parent / "rot_trans.stl"
        out_path.write_bytes(transformed)
        bb = stl_bounds(out_path)

        # After rotate_x=90: Z range becomes [0, 1]
        # After translate_z=5: Z range becomes [5, 6]
        assert bb.min_z == pytest.approx(5.0, abs=1e-5)
        assert bb.max_z == pytest.approx(6.0, abs=1e-5)

    def test_triangle_count_preserved(self, binary_stl_file):
        """Transform should not change triangle count."""
        raw = binary_stl_file.read_bytes()
        transformed = transform_stl(raw, rotate_y=45.0, translate_x=100.0)

        out_path = binary_stl_file.parent / "count_check.stl"
        out_path.write_bytes(transformed)
        bb = stl_bounds(out_path)

        assert bb.num_triangles == 1


class TestTransformStlAscii:
    """Test rotation and translation on ASCII STL data."""

    def test_identity_transform(self, ascii_stl_file):
        """No rotation or translation returns identical bytes."""
        raw = ascii_stl_file.read_bytes()
        result = transform_stl(raw)
        assert result == raw

    def test_translate_z(self, ascii_stl_file):
        """Translate vertices by +10 in Z."""
        raw = ascii_stl_file.read_bytes()
        transformed = transform_stl(raw, translate_z=10.0)

        out_path = ascii_stl_file.parent / "shifted_ascii.stl"
        out_path.write_bytes(transformed)
        bb = stl_bounds(out_path)

        assert bb.min_z == pytest.approx(10.0)
        assert bb.max_z == pytest.approx(10.0)
        assert bb.min_x == pytest.approx(0.0)

    def test_rotate_90_x(self, ascii_stl_file):
        """Rotate 90° around X on ASCII STL."""
        raw = ascii_stl_file.read_bytes()
        transformed = transform_stl(raw, rotate_x=90.0)

        out_path = ascii_stl_file.parent / "rotated_ascii.stl"
        out_path.write_bytes(transformed)
        bb = stl_bounds(out_path)

        assert bb.max_z == pytest.approx(1.0, abs=1e-5)
        assert bb.max_y == pytest.approx(0.0, abs=1e-5)


# ---------------------------------------------------------------------------
# Cylinder STL generator
# ---------------------------------------------------------------------------


class TestGenerateCylinderStl:
    def test_cylinder_x_axis_triangle_count(self):
        """X-axis cylinder has 4*32=128 triangles."""
        raw = generate_cylinder_stl(origin=(0, 0, 0), axis=(1, 0, 0), radius=0.5, half_length=1.0)
        count = struct.unpack_from("<I", raw, 80)[0]
        assert count == 128

    def test_cylinder_bounds_x_axis(self):
        """Cylinder along X axis: X spans origin +/- half_length, Y/Z spans +/- radius."""
        raw = generate_cylinder_stl(origin=(1.0, 2.0, 3.0), axis=(1, 0, 0), radius=0.5, half_length=0.25)
        # Parse bounds from raw bytes
        min_x = min_y = min_z = float("inf")
        max_x = max_y = max_z = float("-inf")
        n = struct.unpack_from("<I", raw, 80)[0]
        offset = 84
        for _ in range(n):
            verts = struct.unpack_from("<9f", raw, offset + 12)
            for i in range(3):
                x, y, z = verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2]
                min_x, max_x = min(min_x, x), max(max_x, x)
                min_y, max_y = min(min_y, y), max(max_y, y)
                min_z, max_z = min(min_z, z), max(max_z, z)
            offset += 50

        assert min_x == pytest.approx(0.75, abs=0.01)
        assert max_x == pytest.approx(1.25, abs=0.01)
        assert min_y == pytest.approx(1.5, abs=0.01)
        assert max_y == pytest.approx(2.5, abs=0.01)
        assert min_z == pytest.approx(2.5, abs=0.01)
        assert max_z == pytest.approx(3.5, abs=0.01)

    def test_cylinder_arbitrary_axis(self):
        """Cylinder along (1,1,0) normalized: should be tilted 45 degrees."""
        raw = generate_cylinder_stl(origin=(0, 0, 0), axis=(1, 1, 0), radius=0.1, half_length=1.0)
        count = struct.unpack_from("<I", raw, 80)[0]
        assert count == 128
        # Bounds should extend equally in X and Y
        min_x = min_y = float("inf")
        max_x = max_y = float("-inf")
        offset = 84
        for _ in range(count):
            verts = struct.unpack_from("<9f", raw, offset + 12)
            for i in range(3):
                min_x = min(min_x, verts[i * 3])
                max_x = max(max_x, verts[i * 3])
                min_y = min(min_y, verts[i * 3 + 1])
                max_y = max(max_y, verts[i * 3 + 1])
            offset += 50
        # Diagonal axis means X and Y should have similar extent
        assert abs((max_x - min_x) - (max_y - min_y)) < 0.05

    def test_cylinder_zero_radius_raises(self):
        """Zero radius should raise ValueError."""
        with pytest.raises(ValueError, match="positive"):
            generate_cylinder_stl(origin=(0, 0, 0), axis=(1, 0, 0), radius=0, half_length=1.0)

    def test_cylinder_zero_axis_raises(self):
        """Zero axis vector should raise ValueError."""
        with pytest.raises(ValueError, match="zero"):
            generate_cylinder_stl(origin=(0, 0, 0), axis=(0, 0, 0), radius=0.5, half_length=1.0)


# ---------------------------------------------------------------------------
# MRF properties generator
# ---------------------------------------------------------------------------


class TestGenerateMrfProperties:
    def test_single_zone(self):
        """Single MRF zone with correct RPM-to-omega conversion."""
        result = generate_mrf_properties([
            MRFZoneConfig(name="propZone", origin=(0.5, 0, 0.1), axis=(1, 0, 0), rpm=2000),
        ])
        assert "cellZone    propZone" in result
        assert "origin      (0.5 0 0.1)" in result
        assert "axis        (1 0 0)" in result
        assert "209.4395" in result  # 2000 * 2*pi/60
        assert "2000 RPM" in result
        assert "FoamFile" in result
        assert "MRFProperties" in result

    def test_negative_rpm(self):
        """Negative RPM produces negative omega."""
        result = generate_mrf_properties([
            MRFZoneConfig(name="wheelZone", origin=(0, 0, 0), axis=(0, 1, 0), rpm=-500),
        ])
        assert "-52.3599" in result
        assert "-500 RPM" in result


# ---------------------------------------------------------------------------
# Multi-geometry dict generation
# ---------------------------------------------------------------------------


class TestMultiGeometryDicts:
    def _body(self, filename="body.stl"):
        bbox = BoundingBox(min_x=-1, min_y=0, min_z=0, max_x=1, max_y=0.5, max_z=0.5, num_triangles=100)
        return GeometryEntry(filename=filename, bbox=bbox, role="body")

    def _rotating(self, filename="propeller.stl"):
        bbox = BoundingBox(min_x=0.3, min_y=-0.1, min_z=-0.05, max_x=0.7, max_y=0.1, max_z=0.25, num_triangles=50)
        return GeometryEntry(filename=filename, bbox=bbox, role="rotating", refinement_min=6, refinement_max=7)

    def _zone(self, filename="propZone.stl"):
        bbox = BoundingBox(min_x=0.25, min_y=-0.15, min_z=-0.1, max_x=0.75, max_y=0.15, max_z=0.3, num_triangles=128)
        return GeometryEntry(filename=filename, bbox=bbox, role="zone", refinement_min=4, refinement_max=4, zone_name="propZone")

    def test_snappy_multi_geometry_entries(self):
        """snappyHexMeshDict lists all geometries in the geometry section."""
        entries = [self._body(), self._rotating(), self._zone()]
        result = generate_snappy_hex_mesh_dict(entries)
        assert "body.stl" in result
        assert "propeller.stl" in result
        assert "propZone.stl" in result
        assert result.count("triSurfaceMesh") == 3

    def test_snappy_zone_gets_cellzone(self):
        """Zone geometry gets cellZone/faceZone/cellZoneInside, no patchInfo."""
        entries = [self._body(), self._zone()]
        result = generate_snappy_hex_mesh_dict(entries)
        assert "cellZone propZone;" in result
        assert "faceZone propZoneFaces;" in result
        assert "cellZoneInside inside;" in result

    def test_snappy_body_gets_patchinfo(self):
        """Body geometry gets patchInfo with wall type."""
        entries = [self._body(), self._zone()]
        result = generate_snappy_hex_mesh_dict(entries)
        # Check that body section has patchInfo
        body_section = result.split("body")[1].split("}")[0]
        assert "patchInfo" in body_section or "type wall" in result

    def test_snappy_zone_no_patchinfo(self):
        """Zone geometry should NOT have patchInfo block."""
        entries = [self._body(), self._zone()]
        result = generate_snappy_hex_mesh_dict(entries)
        # Find the propZone refinementSurfaces entry and check it has no patchInfo
        zone_start = result.index("propZone\n")
        # Find the closing brace for this entry
        depth = 0
        i = result.index("{", zone_start)
        depth = 1
        i += 1
        while depth > 0 and i < len(result):
            if result[i] == "{": depth += 1
            elif result[i] == "}": depth -= 1
            i += 1
        zone_section = result[zone_start:i]
        assert "patchInfo" not in zone_section

    def test_block_mesh_full_model_with_zone(self):
        """When MRF zone present, blockMeshDict uses full domain (no symWall)."""
        entries = [self._body(), self._zone()]
        result = generate_block_mesh_dict(entries)
        assert "symWall" not in result
        assert "right" in result
        assert "type symmetry" not in result

    def test_block_mesh_half_model_without_zone(self):
        """Without MRF zone, blockMeshDict uses half domain (symWall)."""
        entries = [self._body()]
        result = generate_block_mesh_dict(entries)
        assert "symWall" in result
        assert "type symmetry" in result

    def test_sfe_multi_entries(self):
        """surfaceFeatureExtractDict has one entry per filename."""
        result = generate_surface_feature_extract_dict(["body.stl", "propeller.stl", "propZone.stl"])
        assert result.count("extractionMethod") == 3
        assert "body.stl" in result
        assert "propeller.stl" in result
        assert "propZone.stl" in result

    def test_snappy_features_all_geometries(self):
        """Features section has .eMesh entry for each geometry."""
        entries = [self._body(), self._rotating(), self._zone()]
        result = generate_snappy_hex_mesh_dict(entries)
        assert "body.eMesh" in result
        assert "propeller.eMesh" in result
        assert "propZone.eMesh" in result

    def test_single_geometry_backward_compat(self):
        """Single-element list produces valid output with symWall."""
        entries = [self._body()]
        result = generate_snappy_hex_mesh_dict(entries)
        assert "body.stl" in result
        assert "triSurfaceMesh" in result
        assert "patchInfo" in result
        assert "cellZone" not in result
        bmd = generate_block_mesh_dict(entries)
        assert "symWall" in bmd

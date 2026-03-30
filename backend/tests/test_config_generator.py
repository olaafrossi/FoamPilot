"""Tests for services.config_generator — STL parsing and OpenFOAM dict generation."""

from __future__ import annotations

import struct
from pathlib import Path

import pytest

from services.config_generator import (
    BoundingBox,
    generate_block_mesh_dict,
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
        result = generate_block_mesh_dict(bbox, "car.stl")

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
        result = generate_block_mesh_dict(bbox, "tiny.stl")

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
        result = generate_block_mesh_dict(bbox, "car.stl", domain_type="ground_vehicle")

        # z_min should be 0 (ground plane)
        assert "lowerWall" in result
        assert 'type wall;' in result
        # Y=0 symmetry plane
        assert "type symmetry;" in result

    def test_generate_block_mesh_dict_freestream(self):
        """Freestream domain: symmetric z, lowerWall is patch (not wall), Y=0 symmetry."""
        bbox = self._make_bbox(min_x=-0.5, min_y=-0.3, min_z=-0.1, max_x=0.5, max_y=0.3, max_z=0.2)
        result = generate_block_mesh_dict(bbox, "plane.stl", domain_type="freestream")

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
        result = generate_snappy_hex_mesh_dict(bbox, "car.stl")

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
        result = generate_surface_feature_extract_dict("car.stl")

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

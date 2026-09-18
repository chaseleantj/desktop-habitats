# Reefscape assets

`live-rock.bin` is the deterministic signed-density limestone surface, with indexed geometry, normals, color variation and baked local visibility. `rock-support.bin` contains the top-surface field rasterized from that mesh. Rebuild both with `tools/bake-live-rock.py`.

`limestone-detail.png` and `limestone-normal.png` are seamless procedural pore/height and normal maps, rebuilt by `tools/bake-rock-detail.py`.

These assets are part of this project's procedural artwork. The scene also reads the existing sand and rock maps from `scenes/riverscape/assets/`; their existing attribution/license documentation remains in the project. The generated tank-reference images live only under documentation, never in the runtime environment.

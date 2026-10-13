# Assets & Licenses

## External assets

**None.** This demo downloads or bundles no external textures, models, audio files, or font
bundles. Following the asset priority rule the project was built under
(1. CC0 / Public Domain → 2. clearly commercial-use-permitted → 3. CC-BY → 4. unclear licence =
forbidden), the option that removes risk 4 entirely was chosen: **every asset is generated
procedurally**.

- Magic circle textures (2 rune rings, geometry rings, core sigil, floor glow): generated at runtime
  with Canvas 2D drawing in `src/assets/proceduralTextures.js`
- Fire / smoke / ash / dust sprites: same file, periodic value-noise fbm + radial falloff
- Ground diffuse/bump, lava tile, meteor crust: same file, seam-free repeating fbm
- Scorch / lava-crack decals, sky fracture, shockwave rings: same file
- All sound: `src/audio/meteorAudio.js`, synthesised with Web Audio API oscillators, noise sources
  and filters

There is no licence trail to keep, because every work was created inside this repository and depends
on no third-party source.

## Third-party library

| Field | Value |
|---|---|
| asset name | three |
| source URL | https://github.com/mrdoob/three.js |
| author | Ricardo Cabello (mrdoob) and contributors |
| license | MIT License |
| attribution required | no (only the condition of keeping the licence text). A copy ships in `node_modules/three/LICENSE` |
| downloaded date | 2026-10-11 (`npm install three@0.186.1`) |
| files actually used | `node_modules/three/build/three.module.js`, `node_modules/three/examples/jsm/postprocessing/*` |

## Deliberately not used

Sources of unknown licence such as free "meteor explosion sound packs" or "magic circle texture
packs" were neither searched for nor used.

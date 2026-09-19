# Pixel puppy asset provenance

## Included source and origin

- Authoring tool: built-in ImageGen; one completed generation request.
- Character direction: user-provided cream puppy and writing-pose visual references. The original reference files and conversation share URL are deliberately omitted from this source package.
- Included authoring output: `sprite-source.png`, a generated eight-frame PNG with a genuine alpha channel, 1774 × 887 pixels. This is the sole image input required by `build-assets.cjs`.
- Character brief: cream puppy with a round head, floppy beige ears, black eyes, warm brown pixel outline, small seated body, and curled tail. Four idle frames, two magnifying-glass research frames, and two pencil-and-paper writing frames. The generated atlas has no logo, text, or drawn checkerboard background.
- The original ImageGen prompt requested four columns and two rows, consistent proportions and baseline, separate transparent cells, a limited palette, and no additional objects. Rebuilding from the included atlas does not call ImageGen or synthesize poses.

## Deterministic packaging

Eight grid cells are inspected for opaque content, resized with nearest-neighbor sampling, centered on 64 × 64 transparent canvases at baseline 60, and composed into a 256 × 128 PNG. The final atlas uses a 64-color palette without dithering. State and tool badges remain separate UI elements.

The generated sprite is embedded in the offline HTML as a data URL. Neither asset assembly nor demo viewing fetches reference artwork from a remote service. Production runtime never generates or edits artwork; this folder is a separate authoring toolchain.

Baseline dependency: Sharp 0.35.4, pinned in this folder's package and lock file.

| Artifact | SHA-256 at packaging |
| --- | --- |
| `sprite-source.png` | `7bd968c4f1a74751d66fdf176b1a15221be3a72bf215ab7602c1557ff15100ba` |
| `public/assets/pet/sprite.png` | `04746ea7c1985acff12abaee2b03559d4a63ee67c65631b066f1d763a94fe31d` |
| `docs/demo/index.html` | `72b9bd30c9c64dfe10dc2c6cfe974e06ede841ccc3a549624873c5c5a2f6627d` |

The source package does not include or grant rights to the omitted reference images. No exclusive rights or ownership of third-party tool names or trademarks are claimed. Preserve the applicable project licensing and asset provenance when redistributing these files.

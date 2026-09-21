# Pixel puppy asset provenance

## Included source and origin

- Authoring tool: built-in ImageGen; one original generation request and five additional v4 motion requests.
- Character direction: user-provided cream puppy and writing-pose visual references. The original reference files and conversation share URL are deliberately omitted from this source package.
- Original authoring output: `sprite-source.png`, a generated eight-frame PNG with a genuine alpha channel, 1774 × 887 pixels. This remains the input for the unchanged native pet atlas.
- v4 authoring outputs: `motion-sources/thinking.png`, `tool.png`, `dizzy.png`, `angry.png`, and `celebrate.png`. Each is a transparent 1774 × 887 PNG containing two horizontal poses, generated using the original atlas as the character reference. Exact prompts are preserved in `motion-prompts.json`.
- Character brief: cream puppy with a round head, floppy beige ears, black eyes, warm brown pixel outline, small seated body, and curled tail. Four idle frames, two magnifying-glass research frames, and two pencil-and-paper writing frames. The generated atlas has no logo, text, or drawn checkerboard background.
- The original ImageGen prompt requested four columns and two rows, consistent proportions and baseline, separate transparent cells, a limited palette, and no additional objects. Rebuilding from the included atlas does not call ImageGen or synthesize poses.

## Deterministic packaging

Eight grid cells are inspected for opaque content, resized with nearest-neighbor sampling, centered on 64 × 64 transparent canvases at baseline 60, and composed into a 256 × 128 PNG. The final atlas uses a 64-color palette without dithering. State and tool badges remain separate UI elements.

The generated sprite is embedded in the offline HTML as a data URL. Neither asset assembly nor demo viewing fetches reference artwork from a remote service. Production runtime never generates or edits artwork; this folder is a separate authoring toolchain.

For the v4 promotion, the original eight frames are reused and ten new frames are appended in a separate 256 × 320 atlas. Each new pair shares its crop, nearest-neighbor scale, center, and baseline 60. `promo-motion-config.json` defines animation frames, playback rates, and representative still frames. The native sprite and native state types are not changed. HTML supplies text, badges, token fixtures, and stage controls; no text is painted into the motion artwork.

Baseline dependency: Sharp 0.35.4, pinned in this folder's package and lock file.

| Artifact | SHA-256 at packaging |
| --- | --- |
| `sprite-source.png` | `7bd968c4f1a74751d66fdf176b1a15221be3a72bf215ab7602c1557ff15100ba` |
| `apps/desktop/public/assets/pet/sprite.png` | `04746ea7c1985acff12abaee2b03559d4a63ee67c65631b066f1d763a94fe31d` |
| `motion-sources/thinking.png` | `5bf8804f37c1f52438057ce1c4aa5dd1cde2deac1e8bb99542337d395df66dc3` |
| `motion-sources/tool.png` | `3ecbedaca4013b446f9f1a61e16904498856cfdc9bfa51b24f56ad6e158c23d4` |
| `motion-sources/dizzy.png` | `d92dd54c385da105bcf82500bb31d7369156050a72a28ca5cd3ae93feb24b1c7` |
| `motion-sources/angry.png` | `a7a9f505c9b997bb00ca953c15e23da6e0ff6dbe7a089232ab399b3692321732` |
| `motion-sources/celebrate.png` | `bd4456b65ef939ac5f6537fd0b15781d483c2c00141996b6890de21752180060` |

The source package does not include or grant rights to the omitted reference images. No exclusive rights or ownership of third-party tool names or trademarks are claimed. Preserve the applicable project licensing and asset provenance when redistributing these files.

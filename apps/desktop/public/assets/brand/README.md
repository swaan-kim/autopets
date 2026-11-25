# AutoPets brand assets

The two marks have different uses, selected by the product owner on 2026-11-25:

- `autopets-logo.svg` / `.png`: the running cream puppy beside the purple AutoPets wordmark, for the app header.
- `autopets-mark.svg` / `.png`: the simplified puppy face, for the app symbol, favicon and AutoPets source badges.

The illustrations were made with the built-in image generation tool using the existing AutoPets puppy as a character reference. The SVG files embed their PNG images and have transparent backgrounds; they do not require external image requests. They are raster artwork in SVG containers, not editable vector drawings.

The normalized, transparent app-icon source is `apps/desktop/src-tauri/icons/source.png`; `source.svg` contains the same image. Windows ICO and PNG variants were exported with the project's existing Tauri CLI. To regenerate into a temporary folder from the repository root:

```powershell
pnpm --filter @autopets/desktop exec tauri icon src-tauri/icons/source.png --output ../../work/brand-icons
```

Copy only the existing Windows icon filenames into `src-tauri/icons`. Generating icon files does not update an already-installed executable; the new executable and installer must be built from this source.

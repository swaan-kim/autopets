import type { PetCatalogEntry } from './petCatalog';
import { ResultPreview } from './TaskPetArt';
import './pet-card-thumb.css';

// A card and its detail show the same authored example. Compact previews contain no controls.
export function PetCardThumb({ entry }: { entry: PetCatalogEntry }) {
  return <ResultPreview entry={entry} compact />;
}

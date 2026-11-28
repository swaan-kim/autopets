/** Pet decoration state from the app (`pet_custom_snapshot`). Counts and item ids only; no chat text. */
export interface PetCustomView {
  coins: number;
  owned: string[];
  /** Slot id (head, face, neck, background) → worn item id. */
  worn: Record<string, string>;
  /** Finished tasks counted for evolution, including the one-time first grant. */
  completed: number;
  byPet: Record<string, number>;
  /** Evolution stage numbers that are open. */
  unlocked: number[];
}

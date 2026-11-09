// A small presentation-only channel from a pet window's pointer/window events to
// its pet's body motion. It never carries task state or reaches the bridge.
export type PetMotionEvent =
  | { type: 'press' }
  | { type: 'look'; x: number; y: number }
  | { type: 'away' }
  | { type: 'grab' }
  | { type: 'drag'; x: number; y: number }
  | { type: 'release' };
export interface PetMotionInput { emit(event: PetMotionEvent): void; subscribe(listener: (event: PetMotionEvent) => void): () => void }

export function createPetMotionInput(): PetMotionInput {
  const listeners = new Set<(event: PetMotionEvent) => void>();
  return {
    emit: event => listeners.forEach(listener => listener(event)),
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
  };
}

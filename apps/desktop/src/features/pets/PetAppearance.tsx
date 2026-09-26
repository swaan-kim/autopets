import type { ReactNode } from 'react';
import type { PetRoleTemplate } from '@autopets/contracts/types';
import './appearance.css';

export function PetAppearance({ template, children }: { template?: PetRoleTemplate; children: ReactNode }) {
  return <span className="pet-appearance">
    {template?.background === 'meadow' && <span className="pet-meadow" aria-label="풀밭 배경" />}
    {children}
    {template?.prop === 'notebook' && <span className="pet-notebook" aria-label="노트 소품">▤</span>}
  </span>;
}

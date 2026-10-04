import type { ChatIdentity } from './assistance';

export type IntroTemplateId = 'product-intro' | 'plan-summary' | 'comparison';
export type IntroLayout = 'landscape' | 'portrait';
export interface IntroBrief {
  audience: string;
  message: string;
  points: string[];
  sourceText: string;
  sourceLabel: string;
}
export interface IntroStyle {
  palette: string[];
  logoDataUrl: string | null;
  copyLength: 'short' | 'normal';
  layout: IntroLayout;
}
export interface ArtifactCheck {
  id: string;
  status: 'pass' | 'warning' | 'pending';
  detail: string;
  method: 'code' | 'human';
}
export interface ArtifactReview {
  readability: 'pending' | 'pass' | 'fail';
  layout: 'pending' | 'pass' | 'fail';
  fidelity: 'pending' | 'pass' | 'fail';
}
export interface ArtifactVersion {
  id: string;
  createdAt: number;
  width: number;
  height: number;
  renderedText: string;
  brief: IntroBrief;
  style: IntroStyle;
  templateId: IntroTemplateId;
  revisionRequest: ArtifactRevision | null;
  checks: ArtifactCheck[];
  review: ArtifactReview;
  acceptedAt: number | null;
}
export interface ArtifactRevision {
  kind: 'shorten' | 'emphasize' | 'restructure' | 'custom';
  instruction: string;
  baseVersionId: string;
}
export interface ArtifactProject {
  identity: ChatIdentity;
  revision: number;
  templateId: IntroTemplateId;
  brief: IntroBrief;
  style: IntroStyle;
  versions: ArtifactVersion[];
  pendingRevision: ArtifactRevision | null;
  favorite: boolean;
  updatedAt: number;
}
export interface SavedIntroStyle {
  id: string;
  name: string;
  templateId: IntroTemplateId;
  style: IntroStyle;
  updatedAt: number;
}
export interface ArtifactSnapshot {
  projects: ArtifactProject[];
  styles: SavedIntroStyle[];
  observedChats: ChatIdentity[];
  capabilities: { automaticGeneration: false; modelSwitch: false; liveConnectionVerified: false };
}
type Bound = { identity: ChatIdentity; expectedRevision: number };
export type ArtifactRequest =
  | (Bound & { operation: 'save-brief'; templateId: IntroTemplateId; brief: IntroBrief; style: IntroStyle })
  | (Bound & { operation: 'request-revision'; revisionRequest: ArtifactRevision })
  | (Bound & { operation: 'import-version'; pngBytes: number[]; renderedText: string })
  | (Bound & { operation: 'review-version'; versionId: string; review: ArtifactReview })
  | (Bound & { operation: 'accept-version'; versionId: string })
  | (Bound & { operation: 'set-favorite'; favorite: boolean })
  | (Bound & { operation: 'delete-project' })
  | (Bound & { operation: 'save-style'; versionId: string; name: string; styleId?: string })
  | { operation: 'delete-style'; styleId: string };

export interface IntroTemplate {
  id: IntroTemplateId;
  title: string;
  description: string;
  example: { audience: string; message: string; points: string[] };
  requiredCapabilities: string[];
  checkItems: string[];
}

/** A chosen integration target is not proof of a connected host or feature. */
export type FeatureEvidence = 'implemented-unverified' | 'planned' | 'guidance-only' | 'unsupported' | 'verified';
export interface ConnectionHost {
  id: string;
  label: string;
  provider: 'openai' | 'anthropic' | 'google';
  surface: string;
  execution: 'local' | 'cloud';
  stage: 'implementation' | 'compatibility' | 'planned' | 'guidance';
  connectAvailable: boolean;
  /** model/reasoning/planMode mean changes, not merely observing their values. */
  features: Record<'status' | 'guidance' | 'settingsObservation' | 'model' | 'reasoning' | 'planMode' | 'submission' | 'usage' | 'returnToTask', FeatureEvidence>;
}
export interface ConnectionProgress {
  hostId: string;
  configured: boolean;
  status: 'disconnected' | 'waiting-for-event' | 'connected';
  /** Unknown versions stay unknown; configuration never supplies observed evidence. */
  hostVersion: string | null;
  firstTask: { sessionId: string; lastEventAt: number } | null;
  guidanceDelivered: boolean;
  settingsVerified: { model: boolean; reasoning: boolean; submission: boolean };
}

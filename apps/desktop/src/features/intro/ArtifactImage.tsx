import { useEffect, useState } from 'react';
import type { ChatIdentity } from '@autopets/contracts/types';
import { command } from '../../bridge/command';
import { identityKey } from '../assistance/identity';

export function ArtifactImage({ identity, versionId, label }: { identity: ChatIdentity; versionId: string; label: string }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const scope = identityKey(identity);
  useEffect(() => {
    let disposed = false;
    let objectUrl = '';
    setUrl(''); setError('');
    void command<number[]>('artifact_image', { identity, versionId }).then(bytes => {
      if (disposed) return;
      objectUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
      setUrl(objectUrl);
    }).catch(cause => { if (!disposed) setError(String(cause)); });
    return () => { disposed = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [scope, versionId]);
  return <div className="intro-artifact-image">{url ? <img src={url} alt={label} /> : <p role={error ? 'alert' : 'status'}>{error ? `이미지를 열지 못했어요. ${error}` : '이미지를 불러오는 중이에요.'}</p>}</div>;
}

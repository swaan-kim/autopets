import { MAX_FRAME, ProtocolError } from '../extension/protocol.mjs';
export function encodeFrame(value){const bytes=Buffer.from(JSON.stringify(value));if(!bytes.length||bytes.length>MAX_FRAME)throw new ProtocolError('frame-size');const h=Buffer.alloc(4);h.writeUInt32LE(bytes.length);return Buffer.concat([h,bytes]);}
export class FrameDecoder {
 constructor(onMessage){this.onMessage=onMessage;this.header=Buffer.alloc(4);this.headerBytes=0;this.body=null;this.bodyBytes=0;}
 push(chunk){let p=0;while(p<chunk.length){if(!this.body){const n=Math.min(4-this.headerBytes,chunk.length-p);chunk.copy(this.header,this.headerBytes,p,p+n);p+=n;this.headerBytes+=n;if(this.headerBytes<4)continue;const length=this.header.readUInt32LE();if(length===0||length>MAX_FRAME)throw new ProtocolError('frame-size');this.body=Buffer.alloc(length);this.bodyBytes=0;}const n=Math.min(this.body.length-this.bodyBytes,chunk.length-p);chunk.copy(this.body,this.bodyBytes,p,p+n);p+=n;this.bodyBytes+=n;if(this.bodyBytes===this.body.length){let message;try{message=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(this.body));}catch{throw new ProtocolError('frame-json');}this.headerBytes=0;this.body=null;this.bodyBytes=0;this.onMessage(message);}}}
 end(){if(this.headerBytes||this.body)throw new ProtocolError('frame-truncated');}
}

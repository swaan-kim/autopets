import { utf8Bytes } from './constants.mjs';

// Match Rust String::len (UTF-8 bytes) and char::is_control, not JS UTF-16 length.
export const controlCharacters = /[\u0000-\u001f\u007f-\u009f]/u;
const unsupportedContentControls = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u;
const unpairedSurrogate = /[\ud800-\udfff]/u;
export const bounded = (value, bytes, allowEmpty = false) => typeof value === 'string'
  && (allowEmpty || !!value.trim()) && utf8Bytes(value) <= bytes
  && !unsupportedContentControls.test(value) && !unpairedSurrogate.test(value);

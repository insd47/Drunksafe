const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const padding = '=';

export function encodeUtf8Base64(value: string) {
  const bytes = utf8Bytes(value);
  let encoded = '';

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const triplet = (first << 16) | (second << 8) | third;

    encoded += alphabet[(triplet >> 18) & 63];
    encoded += alphabet[(triplet >> 12) & 63];
    encoded += index + 1 < bytes.length ? alphabet[(triplet >> 6) & 63] : padding;
    encoded += index + 2 < bytes.length ? alphabet[triplet & 63] : padding;
  }

  return encoded;
}

export function utf8ByteLength(value: string) {
  return utf8Bytes(value).length;
}

export function decodeUtf8Base64(value: string) {
  const clean = value.replace(/\s/g, '');

  if (clean.length % 4 !== 0) {
    throw new Error('Invalid BLE base64 payload');
  }

  const bytes: number[] = [];

  for (let index = 0; index < clean.length; index += 4) {
    const first = decodeBase64Char(clean[index]);
    const second = decodeBase64Char(clean[index + 1]);
    const third = clean[index + 2] === padding ? 0 : decodeBase64Char(clean[index + 2]);
    const fourth = clean[index + 3] === padding ? 0 : decodeBase64Char(clean[index + 3]);
    const triplet = (first << 18) | (second << 12) | (third << 6) | fourth;

    bytes.push((triplet >> 16) & 255);

    if (clean[index + 2] !== padding) {
      bytes.push((triplet >> 8) & 255);
    }

    if (clean[index + 3] !== padding) {
      bytes.push(triplet & 255);
    }
  }

  return utf8String(bytes);
}

function decodeBase64Char(value: string | undefined) {
  if (!value || value === padding) {
    throw new Error('Invalid BLE base64 payload');
  }

  const index = alphabet.indexOf(value);

  if (index < 0) {
    throw new Error('Invalid BLE base64 payload');
  }

  return index;
}

function utf8Bytes(value: string) {
  const escaped = encodeURIComponent(value);
  const bytes: number[] = [];

  for (let index = 0; index < escaped.length; index += 1) {
    if (escaped[index] === '%') {
      bytes.push(Number.parseInt(escaped.slice(index + 1, index + 3), 16));
      index += 2;
    } else {
      bytes.push(escaped.charCodeAt(index));
    }
  }

  return bytes;
}

function utf8String(bytes: number[]) {
  const escaped = bytes.map((byte) => `%${byte.toString(16).padStart(2, '0')}`).join('');
  return decodeURIComponent(escaped);
}

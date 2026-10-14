// Avoid an intermediate array of millions of characters when verifying videos.
export function base64Bytes(value:string) {
  const raw=atob(value),bytes=new Uint8Array(raw.length);
  for(let index=0;index<raw.length;index++)bytes[index]=raw.charCodeAt(index);
  return bytes;
}

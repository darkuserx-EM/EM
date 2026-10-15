export default function PrivateAttachment({url,name,mime,caption}:{url:string;name:string;mime:string;caption:string}) {
  if(mime==='video/mp4')return <figure className="attachment-video"><video controls playsInline preload="none" src={url} aria-label={`Video: ${name}`}/><figcaption><strong>{name}</strong><small>{caption} · Video</small><a href={url} target="_blank" rel="noreferrer">Abrir video</a></figcaption></figure>;
  return <a href={url} target="_blank" rel="noreferrer">{mime.startsWith('image/')&&<img loading="lazy" src={url} alt={name}/>}<strong>{name}</strong><small>{caption}<span className="attachment-open"> · Abrir</span></small></a>;
}

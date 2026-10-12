import { useRef, useState } from 'react';
import { Download, ArchiveRestore } from 'lucide-react';
import { api } from '../../data/remote';
import { archiveLines, inspectFullBackup } from '../../data/full-backup';
import { getDataSource } from '../../data/source';
import { useActor } from '../../app/state';
import { ErrorNotice, Modal } from '../../components/ui';

export default function FullBackup() {
  const actor = useActor(); const input = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<{ file: File; info: Awaited<ReturnType<typeof inspectFullBackup>>; revision: number } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [checked, setChecked] = useState(false);
  async function choose(file?: File) {
    if (!file) return; setBusy(true); setError(''); setNotice('Verificando registros, fotografías y evidencias…'); setSelected(null); setChecked(false);
    try { const revision = getDataSource().getRevision(); const info = await inspectFullBackup(file); setSelected({ file, info, revision }); setNotice(''); }
    catch (cause) { setError((cause as Error).message); setNotice(''); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  }
  async function restore() {
    if (!selected || !checked) return; setBusy(true); setError(''); let photos = 0, attachments = 0, records = false;
    try {
      // Stage images before changing records, so no committed equipment points to a missing file.
      for await (const { entry } of archiveLines(selected.file)) if (entry.type === 'media') {
        await api('admin/media/restore', { file: entry.file }); photos++; setNotice(`Fotografías verificadas: ${photos} de ${selected.info.counts.media}.`);
        await new Promise(resolve => setTimeout(resolve, 350));
      }
      for await (const { entry } of archiveLines(selected.file)) if (entry.type === 'attachment') {
        await api('admin/attachments/restore', { file: entry.file, allowOrphan: true }); attachments++; setNotice(`Evidencias recuperadas: ${attachments} de ${selected.info.counts.attachment}.`);
        await new Promise(resolve => setTimeout(resolve, 350));
      }
      await getDataSource().restore(actor, selected.info.database, selected.revision, selected.info.exportedAt); records = true;
      setNotice(`Recuperación completa: ${selected.info.counts.record} registros, ${photos} fotografías y ${attachments} evidencias. La bitácora vigente se conservó.`); setSelected(null);
    } catch (cause) {
      setError(`${records ? 'Los registros ya se recuperaron.' : 'Los registros no se reemplazaron.'} Fotografías preparadas: ${photos}; evidencias recuperadas: ${attachments}. ${(cause as Error).message} Puedes seleccionar el mismo respaldo y reintentar; los archivos idénticos no se duplican.`);
      setSelected(null); setNotice('');
    } finally { setBusy(false); }
  }
  return <section className="panel access-accounts"><h2>Respaldo completo del portal</h2><p>Un solo archivo con registros, historial, fotografías de equipos, placas y evidencias de órdenes. Las fotografías se recuperan una por una para evitar envíos grandes.</p><div className="ops-table-actions"><a className="button button-dark" href="/api/admin/full-backup" download><Download size={17}/>Descargar respaldo completo</a><button className="button" disabled={busy} onClick={() => input.current?.click()}><ArchiveRestore size={17}/>Revisar respaldo completo</button><input ref={input} type="file" accept=".jsonl" aria-label="Respaldo completo con fotografías" className="visually-hidden" onChange={e => choose(e.target.files?.[0])}/></div><p className="field-help">Las fotos retiradas se conservan en el respaldo, sin borrado automático. Las cuentas y la configuración se recuperan desde la copia del alojamiento.</p><ErrorNotice message={error}/>{notice && <p role="status">{notice}</p>}{selected && <Modal title="Revisar recuperación completa" onClose={() => { if (!busy) setSelected(null); }}><p><strong>{selected.file.name}</strong></p><p>{selected.info.counts.record} registros · {selected.info.counts.media} fotografías · {selected.info.counts.attachment} evidencias. Integridad y referencias verificadas.</p><p>Primero descarga una copia completa del estado actual. Al continuar se reemplazan los registros operativos y se conserva la bitácora vigente.</p><a className="button" href="/api/admin/full-backup" download>Descargar copia del estado actual</a><label className="check-field restore-check"><input type="checkbox" checked={checked} disabled={busy} onChange={e => setChecked(e.target.checked)}/>Conservé la copia actual y deseo recuperar este respaldo.</label><ErrorNotice message={error}/>{notice && <p role="status">{notice}</p>}<div className="modal-actions"><button className="button" disabled={busy} onClick={() => setSelected(null)}>Cancelar</button><button className="button button-dark" disabled={!checked || busy} onClick={restore}>{busy ? 'Recuperando…' : 'Restaurar respaldo completo'}</button></div></Modal>}</section>;
}

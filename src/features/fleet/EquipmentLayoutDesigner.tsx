import { useRef, useState, type ReactNode, type PointerEvent, type KeyboardEvent } from 'react';
import { ArrowLeft, Download, Eye, GripHorizontal, MoveDownRight, RotateCcw, Undo2, Upload } from 'lucide-react';
import { useActor } from '../../app/state';
import { adjustLayout, decodeLayout, defaultLayout, encodeLayout, layoutDefinitions, layoutGrid, type LayoutId, type LayoutItem } from './equipment-layout';
import './equipment-layout-designer.css';

type Block = { id: LayoutId; title: string; content: ReactNode };
type Gesture = { id: LayoutId; mode: 'move' | 'resize'; pointerId: number; startX: number; startY: number; columnStep: number; scrollY: number; before: LayoutItem[] };

export function EquipmentLayoutDesigner({ blocks, onClose }: { blocks: Block[]; onClose: () => void }) {
  const actor = useActor();
  const storageKey = `portal-em:equipment-layout:v1:${actor.id}`;
  const [initial] = useState(() => {
    try { const saved = localStorage.getItem(storageKey); return { items: saved ? decodeLayout(saved) : defaultLayout(), message: saved ? 'Diseño recuperado de este navegador.' : 'Distribución inicial lista para ajustar. La ficha original sigue igual.' }; }
    catch { return { items: defaultLayout(), message: 'No se pudo recuperar el diseño guardado. Puedes cargar un archivo o comenzar de nuevo.' }; }
  });
  const [items, setItems] = useState(initial.items);
  const current = useRef(items);
  const [message, setMessage] = useState(initial.message);
  const [selected, setSelected] = useState<LayoutId>('meter');
  const [preview, setPreview] = useState(false);
  const [undo, setUndo] = useState<LayoutItem[][]>([]);
  const gesture = useRef<Gesture | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const uploader = useRef<HTMLInputElement>(null);
  const chosen = items.find(item => item.id === selected)!;
  const definition = layoutDefinitions.find(item => item.id === selected)!;
  const update = (next: LayoutItem[]) => { current.current = next; setItems(next); };
  const save = (next: LayoutItem[]) => {
    try { localStorage.setItem(storageKey, encodeLayout(next)); setMessage('Diseño guardado en este navegador. La ficha original sigue igual.'); }
    catch { setMessage('No se pudo guardar en este navegador. Descarga el diseño para conservarlo.'); }
  };
  const commit = (next: LayoutItem[], before = current.current) => {
    if (JSON.stringify(next) === JSON.stringify(before)) return;
    setUndo(history => [...history.slice(-19), before]); update(next); save(next);
  };
  const change = (patch: Partial<Omit<LayoutItem, 'id'>>) => commit(adjustLayout(current.current, selected, patch));
  function start(event: PointerEvent<HTMLButtonElement>, id: LayoutId, mode: Gesture['mode']) {
    if (event.button !== 0 || !canvas.current || preview) return;
    event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); setSelected(id);
    gesture.current = { id, mode, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, columnStep: (canvas.current.clientWidth + layoutGrid.gap) / layoutGrid.columns, scrollY: window.scrollY, before: current.current };
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const original = active.before.find(item => item.id === active.id)!;
    const dx = Math.round((event.clientX - active.startX) / active.columnStep);
    const dy = Math.round((event.clientY - active.startY + window.scrollY - active.scrollY) / (layoutGrid.rowHeight + layoutGrid.gap));
    update(adjustLayout(active.before, active.id, active.mode === 'move' ? { x: original.x + dx, y: original.y + dy } : { w: original.w + dx, h: original.h + dy }));
  }
  function end(event: PointerEvent<HTMLButtonElement>, cancel = false) {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    gesture.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (cancel) update(active.before); else commit(current.current, active.before);
  }
  function keyboard(event: KeyboardEvent<HTMLButtonElement>, item: LayoutItem, mode: Gesture['mode']) {
    const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!direction) return;
    event.preventDefault(); setSelected(item.id);
    commit(adjustLayout(current.current, item.id, mode === 'move' ? { x: item.x + direction[0], y: item.y + direction[1] } : { w: item.w + direction[0], h: item.h + direction[1] }));
  }
  function download() {
    const url = URL.createObjectURL(new Blob([encodeLayout(current.current, canvas.current?.clientWidth)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'Portal-EM-diseno-ficha.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage('Diseño descargado. Puedes compartir el archivo para trasladar esta distribución a la ficha original.');
  }
  async function loadFile(file?: File) {
    if (!file) return;
    try {
      if (file.size > 32_768) throw new Error('El archivo de diseño es demasiado grande.');
      const next = decodeLayout(await file.text()); commit(next); setMessage('Diseño cargado; solo cambia esta vista de prueba.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo cargar el diseño.'); }
    finally { if (uploader.current) uploader.current.value = ''; }
  }
  return <section className={`equipment-layout-designer${preview ? ' is-preview' : ''}`} aria-label="Diseño opcional de la ficha" onKeyDown={event => { if (event.key === 'Escape' && gesture.current) { update(gesture.current.before); gesture.current = null; } }}>
    <header className="layout-editor-heading"><div><span>DISEÑO DE PRUEBA · RESUMEN</span><h2>Organiza tu ficha</h2><p>Mueve y ajusta los bloques. Esta distribución se guarda solo en tu navegador.</p></div><button className="button" onClick={onClose}><ArrowLeft size={15} />Volver a la ficha original</button></header>
    <div className="layout-editor-toolbar">
      <button className="button button-dark" aria-pressed={preview} onClick={() => setPreview(!preview)}><Eye size={15} />{preview ? 'Seguir editando' : 'Vista previa'}</button>
      <button className="button" disabled={!undo.length} onClick={() => { const previous = undo.at(-1)!; setUndo(history => history.slice(0, -1)); update(previous); save(previous); }}><Undo2 size={15} />Deshacer</button>
      <button className="button" onClick={() => commit(defaultLayout())}><RotateCcw size={15} />Restablecer</button>
      <button className="button" onClick={download}><Download size={15} />Descargar diseño</button>
      <button className="button" onClick={() => uploader.current?.click()}><Upload size={15} />Cargar diseño</button>
      <input ref={uploader} type="file" accept=".json,application/json" aria-label="Archivo de diseño" hidden onChange={event => void loadFile(event.target.files?.[0])} />
    </div>
    {!preview && <div className="layout-editor-controls">
      <label>Bloque<select value={selected} onChange={event => setSelected(event.target.value as LayoutId)}>{blocks.map(block => <option value={block.id} key={block.id}>{block.title}</option>)}</select></label>
      <label>Ancho · {Math.round(chosen.w / 12 * 100)}%<input aria-label="Ancho del bloque en columnas" type="range" min={definition.minW} max="12" value={chosen.w} onChange={event => change({ w: Number(event.target.value) })} /></label>
      <label>Alto · {chosen.h * 52 - 12} px<input aria-label="Alto del bloque en filas" type="range" min={definition.minH} max="32" value={chosen.h} onChange={event => change({ h: Number(event.target.value) })} /></label>
      <label>Columna<input aria-label="Columna del bloque" type="number" min="1" max={13 - chosen.w} value={chosen.x + 1} onChange={event => event.target.value && change({ x: Number(event.target.value) - 1 })} /></label>
      <label>Fila<input aria-label="Fila del bloque" type="number" min="1" max="401" value={chosen.y + 1} onChange={event => event.target.value && change({ y: Number(event.target.value) - 1 })} /></label>
    </div>}
    <p className="layout-editor-status" role="status">{message}</p>
    {!preview && <p className="layout-editor-hint">Arrastra el título para mover y la esquina inferior derecha para redimensionar. También puedes usar las flechas del teclado sobre esos controles. Los bloques se apartan para evitar superponerse.</p>}
    <p className="layout-editor-mobile">El lienzo mantiene un ancho de escritorio. Desliza para recorrerlo o utiliza los controles de ancho, alto y posición.</p>
    <div className="layout-canvas-scroll"><div className="layout-canvas" ref={canvas}>
      {[...items].sort((a, b) => a.y - b.y || a.x - b.x).map(item => { const block = blocks.find(entry => entry.id === item.id)!; return <article key={item.id} className={`layout-block${selected === item.id ? ' is-selected' : ''}`} data-layout-block={item.id} style={{ gridColumn: `${item.x + 1} / span ${item.w}`, gridRow: `${item.y + 1} / span ${item.h}` }} aria-label={block.title} onClick={() => !preview && setSelected(item.id)}>
        {!preview && <button className="layout-block-handle" aria-label={`Mover ${block.title}`} onPointerDown={event => start(event, item.id, 'move')} onPointerMove={move} onPointerUp={event => end(event)} onPointerCancel={event => end(event, true)} onLostPointerCapture={event => end(event, true)} onKeyDown={event => keyboard(event, item, 'move')}><GripHorizontal size={17} /><strong>{block.title}</strong><span>{Math.round(item.w / 12 * 100)}% · {item.h * 52 - 12} px</span></button>}
        <div className="layout-block-content" inert={!preview}>{block.content}</div>
        {!preview && <button className="layout-block-resize" aria-label={`Cambiar tamaño de ${block.title}`} onPointerDown={event => start(event, item.id, 'resize')} onPointerMove={move} onPointerUp={event => end(event)} onPointerCancel={event => end(event, true)} onLostPointerCapture={event => end(event, true)} onKeyDown={event => keyboard(event, item, 'resize')}><MoveDownRight size={18} /></button>}
      </article>; })}
    </div></div>
    <p className="layout-editor-hint">Descarga el diseño cuando estés conforme. El archivo guarda posiciones y tamaños, sin registros ni fotografías.</p>
  </section>;
}

import {useId,useState,type ReactNode} from 'react';
/** Filters remain visible on desktop; mobile can fold controls without hiding the selection. */
export function CompactFilters({summary,children}:{summary:string;children:ReactNode}) {
 const [open,setOpen]=useState(false);const id=useId();
 return <div className="compact-filters"><div className="compact-filters-heading"><span>{summary}</span><button type="button" className="button button-small" aria-expanded={open} aria-controls={id} onClick={()=>setOpen(!open)}>{open?'Ocultar filtros':'Filtros'}</button></div><div id={id} className={`compact-filters-content${open?' is-open':''}`}>{children}</div></div>;
}

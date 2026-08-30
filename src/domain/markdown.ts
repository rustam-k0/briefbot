import type { Brief, FieldValue } from './brief.js';
import { calculateReadiness } from './brief.js';
import type { Locale } from './localization.js';
import { t } from './localization.js';

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
}
function printable(value: unknown): string { return Array.isArray(value) ? value.map(printable).join('; ') : typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? ''); }
function statusLabel(status: FieldValue['status'], locale: Locale): string {
  const labels = { ru:{confirmed:'Подтверждено',inferred:'Нужно подтвердить',missing:'Не хватает',conflicting:'Есть конфликт',skipped:'Пропущено',not_applicable:'Не применяется'}, en:{confirmed:'Confirmed',inferred:'Needs confirmation',missing:'Missing',conflicting:'Conflict',skipped:'Skipped',not_applicable:'Not applicable'} };
  return labels[locale][status];
}
export function renderOverviewHtml(brief: Brief, locale: Locale): string {
  const readiness=calculateReadiness(brief.template,brief.fields); const lines=[`📋 <b>${escapeHtml(brief.title)}</b>`,escapeHtml(t(locale,'completeness')(readiness.confirmed,readiness.required,readiness.percent))];
  if(readiness.needsConfirmation) lines.push(escapeHtml(t(locale,'needsConfirm')(readiness.needsConfirmation)));
  if(readiness.conflicts) lines.push(escapeHtml(t(locale,'conflicts')(readiness.conflicts)));
  const groups: Array<[FieldValue['status'],string]> = [['confirmed',locale==='ru'?'✅ Подтверждено':'✅ Confirmed'],['inferred',locale==='ru'?'💡 Нужно подтвердить':'💡 Needs confirmation'],['conflicting',locale==='ru'?'⚠️ Конфликты':'⚠️ Conflicts']];
  for(const [status,title] of groups){ const rows=brief.template.fields.filter(f=>brief.fields[f.id]?.status===status).slice(0,4); if(rows.length){lines.push('',`<b>${title}</b>`,...rows.map(f=>`• ${escapeHtml(f.label[locale])}: ${escapeHtml(printable(brief.fields[f.id]?.value))}`));} }
  const missing=brief.template.fields.filter(f=>f.required&&(!brief.fields[f.id]||brief.fields[f.id]?.status==='missing')).slice(0,4); if(missing.length) lines.push('',`<b>${locale==='ru'?'❓ Не хватает':'❓ Missing'}</b>`,...missing.map(f=>`• ${escapeHtml(f.label[locale])}`));
  return lines.join('\n');
}
export function renderSectionHtml(brief: Brief, locale: Locale, sectionIndex: number, onlyGaps=false): {html:string;index:number;total:number} {
  const sections=brief.template.sections.filter(s=>s.enabled).sort((a,b)=>a.order-b.order); const index=Math.max(0,Math.min(sectionIndex,sections.length-1)); const section=sections[index]!;
  const fields=brief.template.fields.filter(f=>f.enabled&&f.sectionId===section.id).sort((a,b)=>a.order-b.order).filter(f=>!onlyGaps||brief.fields[f.id]?.status!=='confirmed');
  const rows=fields.map(f=>{const value=brief.fields[f.id]; return value?`• <b>${escapeHtml(f.label[locale])}</b>: ${escapeHtml(printable(value.value))}\n  <i>${escapeHtml(statusLabel(value.status,locale))}</i>`:`• <b>${escapeHtml(f.label[locale])}</b>: —`;});
  return {html:`📋 <b>${escapeHtml(brief.title)}</b>\n<b>${escapeHtml(section.title[locale])}</b> · ${index+1}/${sections.length}\n\n${rows.join('\n')||'—'}`,index,total:sections.length};
}
export function renderFinalMarkdown(brief: Brief, locale: Locale='ru'): string {
  const readiness=calculateReadiness(brief.template,brief.fields); const out=[`# ${brief.title}`,'',t(locale,'completeness')(readiness.confirmed,readiness.required,readiness.percent),''];
  for(const section of brief.template.sections.filter(s=>s.enabled).sort((a,b)=>a.order-b.order)){out.push(`## ${section.title[locale]}`,''); for(const field of brief.template.fields.filter(f=>f.sectionId===section.id&&f.enabled).sort((a,b)=>a.order-b.order)){const value=brief.fields[field.id]; out.push(`- ${field.label[locale]}: ${value?`${printable(value.value)} (${statusLabel(value.status,locale)})`:'—'}`);} out.push('');}
  return out.join('\n');
}
export function splitTelegramHtml(blocks:string[],limit=3900):string[]{const result:string[]=[];let current='';for(const block of blocks){if(block.length>limit){if(current)result.push(current);for(let i=0;i<block.length;i+=limit)result.push(block.slice(i,i+limit));current='';continue;}const next=current?`${current}\n\n${block}`:block;if(next.length>limit){result.push(current);current=block;}else current=next;}if(current)result.push(current);return result;}

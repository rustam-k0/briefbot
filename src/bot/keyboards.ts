import { InlineKeyboard } from 'grammy';
import type { Locale } from '../domain/localization.js';
export function mainKeyboard(locale:Locale){return new InlineKeyboard().text(locale==='ru'?'📋 Бриф':'📋 Brief','show_brief').text(locale==='ru'?'❓ Пробелы':'❓ Gaps','show_progress').row().text(locale==='ru'?'🗂 Мои брифы':'🗂 My briefs','my_briefs').text(locale==='ru'?'⚙️ Ещё':'⚙️ More','more');}
export function moreKeyboard(locale:Locale){return new InlineKeyboard().text(locale==='ru'?'➕ Новый':'➕ New','new_brief').text(locale==='ru'?'🌐 Язык':'🌐 Language','language').row().text(locale==='ru'?'📤 Экспорт':'📤 Export','finish').text(locale==='ru'?'🗑 Данные':'🗑 Data','delete_step_1');}
export const languageKeyboard=new InlineKeyboard().text('Русский','lang:ru').text('English','lang:en');
export function retryKeyboard(locale:Locale,messageId:string){return new InlineKeyboard().text(locale==='ru'?'↻ Повторить':'↻ Retry',`retry:${messageId}`);}
export function finishKeyboard(locale:Locale){return new InlineKeyboard().text(locale==='ru'?'Подтвердить и экспортировать':'Confirm and export','confirm_finish').row().text(locale==='ru'?'Вернуться':'Back','show_brief');}
export function briefNavigation(locale:Locale,index:number,total:number){const k=new InlineKeyboard();if(index>0)k.text('‹',`section:${index-1}`);k.text(`${index+1}/${total}`,'noop');if(index<total-1)k.text('›',`section:${index+1}`);return k.row().text(locale==='ru'?'Только пробелы':'Only gaps',`gaps:${index}`).text(locale==='ru'?'Обзор':'Overview','show_brief');}

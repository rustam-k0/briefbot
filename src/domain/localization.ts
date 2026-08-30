export type Locale = 'ru' | 'en';
const messages = {
  ru: {
    noBrief:'Активный бриф не выбран.', received:'Получил сообщение', prepareAudio:'Подготавливаю аудио', transcribing:'Расшифровываю',
    extracting:'Извлекаю факты', saving:'Проверяю и сохраняю', done:'Готово', temporaryError:'Обработка временно остановилась. Сообщение сохранено — отправлять его заново не нужно.',
    asrError:'Не удалось завершить расшифровку. Голосовое сохранено — отправлять его заново не нужно.', retry:'Повторить',
    saved:(n:number)=>`Сохранил ${n} ${pluralRu(n,'пункт','пункта','пунктов')}.`, need:(n:number)=>`Нужно уточнить ещё ${n} ${pluralRu(n,'обязательный пункт','обязательных пункта','обязательных пунктов')}.`,
    completeness:(a:number,b:number,p:number)=>`Готовность: ${a} из ${b} обязательных пунктов · ${p}%`, needsConfirm:(n:number)=>`Нужно подтвердить: ${n}`, conflicts:(n:number)=>`Есть конфликт: ${n}`,
  },
  en: {
    noBrief:'No active brief is selected.', received:'Message received', prepareAudio:'Preparing audio', transcribing:'Transcribing',
    extracting:'Extracting facts', saving:'Validating and saving', done:'Done', temporaryError:'Processing is temporarily paused. Your message is saved — you do not need to send it again.',
    asrError:'Transcription could not be completed. Your voice message is saved — you do not need to send it again.', retry:'Retry',
    saved:(n:number)=>`Saved ${n} ${n === 1 ? 'item' : 'items'}.`, need:(n:number)=>`${n} more required ${n === 1 ? 'item needs' : 'items need'} clarification.`,
    completeness:(a:number,b:number,p:number)=>`Completeness: ${a} of ${b} required items · ${p}%`, needsConfirm:(n:number)=>`Needs confirmation: ${n}`, conflicts:(n:number)=>`Conflicts: ${n}`,
  },
} as const;
export type TranslationKey = keyof typeof messages.en;
export function t<K extends TranslationKey>(locale: Locale, key: K): (typeof messages)[Locale][K] { return messages[locale][key]; }
export function assertLocaleParity(): boolean { return Object.keys(messages.ru).sort().join('|') === Object.keys(messages.en).sort().join('|'); }
function pluralRu(n:number, one:string, few:string, many:string): string { const m10=n%10,m100=n%100; return m10===1&&m100!==11?one:m10>=2&&m10<=4&&(m100<12||m100>14)?few:many; }

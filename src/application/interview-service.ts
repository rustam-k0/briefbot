import type { Brief,TemplateDefinition } from '../domain/brief.js';
import { calculateReadiness } from '../domain/brief.js';
import type { BriefRepository,ClientIdentity,LLMClient,ModelCallMetadata,PipelineStage,StoredMessage,TranscriptionClient } from './ports.js';
import { ChatQueue } from './chat-queue.js';
import { renderFinalMarkdown,renderOverviewHtml } from '../domain/markdown.js';
import { t,type Locale } from '../domain/localization.js';
import { metrics } from '../infrastructure/observability.js';
export interface ProcessedReply{duplicate?:boolean;reply:string;brief?:Brief;messageId?:string;recoverable?:boolean;}
type Progress=(stage:PipelineStage)=>Promise<void>;
type EventSink=(event:{requestId:string;updateId:number;briefId:string;stage:PipelineStage;source:'text'|'voice';errorCode?:string})=>void;
export class InterviewService{
  private readonly contextQueue=new ChatQueue();
  constructor(private readonly repository:BriefRepository,private readonly llm:LLMClient,private readonly emit:EventSink=()=>{},private readonly queue=new ChatQueue()){}
  ensureActive(chatId:string,client:ClientIdentity){return this.repository.ensureActive(chatId,client);}
  async process(updateId:number,chatId:string,client:ClientIdentity,telegramMessageId:string,text:string,_transcript?:string,progress?:Progress):Promise<ProcessedReply>{
    const ingested=await this.contextQueue.run(chatId,()=>this.repository.ingestMessage({updateId,telegramMessageId,chatId,client,source:'text',rawText:text}));
    if(ingested.duplicate)return{duplicate:true,reply:'',messageId:ingested.message.id};this.event(ingested.message,'received');
    return this.processStored(ingested.message,ingested.brief,text,progress);
  }
  async ingestVoice(input:{updateId:number;chatId:string;client:ClientIdentity;telegramMessageId:string;fileId:string}){
    const ingested=await this.contextQueue.run(input.chatId,()=>this.repository.ingestMessage({updateId:input.updateId,telegramMessageId:input.telegramMessageId,chatId:input.chatId,client:input.client,source:'voice',telegramFileId:input.fileId}));
    if(!ingested.duplicate)this.event(ingested.message,'received');return ingested;
  }
  async attachAudio(messageId:string,filePath:string){await this.repository.updateMessage(messageId,{stage:'audio_saved',storedFilePath:filePath});const message=await this.repository.getMessage(messageId);if(message)this.event(message,'audio_saved');}
  async processVoice(message:StoredMessage,brief:Brief,stt:TranscriptionClient,progress?:Progress):Promise<ProcessedReply>{
    const started=Date.now();let transcript=message.transcript;const models:ModelCallMetadata[]=[];
    try{
      if(!transcript){await progress?.('transcribing');await this.repository.updateMessage(message.id,{stage:'transcribing',incrementAttempts:true});this.event(message,'transcribing');const result=await stt.transcribe(message.storedFilePath!);transcript=result.text;if(result.model)models.push(result.model);await this.repository.updateMessage(message.id,{stage:'transcribed',transcript,...(result.language?{language:result.language}:{}),modelCalls:models});this.event(message,'transcribed');}
      const output=await this.processStored({...message,transcript,stage:'transcribed'},brief,transcript,progress,models);metrics.observe('voice_pipeline',Date.now()-started,!output.recoverable);return output;
    }catch(error){const code=errorCode(error);const locale=await this.repository.getLocale(message.chatId);await this.repository.updateMessage(message.id,{stage:'failed',failedStage:transcript?'extracting':'transcribing',errorCode:code});this.event(message,'failed',code);metrics.observe('voice_pipeline',Date.now()-started,false);return{reply:t(locale,transcript?'temporaryError':'asrError') as string,brief,messageId:message.id,recoverable:true};}
  }
  async retry(messageId:string,stt:TranscriptionClient,progress?:Progress):Promise<ProcessedReply>{const message=await this.repository.getMessage(messageId);if(!message)return{reply:'Message not found.'};const brief=await this.repository.getActive(message.chatId);if(!brief||brief.id!==message.briefId)return{reply:t(await this.repository.getLocale(message.chatId),'noBrief') as string};return message.source==='voice'?this.processVoice(message,brief,stt,progress):this.processStored(message,brief,message.rawText??'',progress);}
  private processStored(message:StoredMessage,brief:Brief,text:string,progress?:Progress,modelCalls:ModelCallMetadata[]=[]):Promise<ProcessedReply>{
    return this.queue.run(brief.id,async()=>{const started=Date.now();const current=await this.repository.getActive(message.chatId);if(!current||current.id!==brief.id)return{reply:t(await this.repository.getLocale(message.chatId),'noBrief') as string,messageId:message.id};
      try{
        await progress?.('extracting');await this.repository.updateMessage(message.id,{stage:'extracting',incrementAttempts:true});this.event(message,'extracting');
        const history=await this.repository.history(brief.id,12);const analyzed=await this.llm.analyze({...(current.opencodeSessionId?{sessionId:current.opencodeSessionId}:{}),template:current.template,brief:current.fields,message:{id:message.id,role:'user',text},history});if(analyzed.model)modelCalls.push(analyzed.model);
        await this.repository.updateMessage(message.id,{stage:'extracted',extracted:analyzed.result,modelCalls});this.event(message,'extracted');await progress?.('saving');await this.repository.updateMessage(message.id,{stage:'saving'});this.event(message,'saving');
        const updated=await this.repository.applyInterview(current.id,current.version,message.id,analyzed.result,analyzed.sessionId,modelCalls);await progress?.('completed');this.event(message,'completed');metrics.observe('text_pipeline',Date.now()-started,true);
        const locale=await this.repository.getLocale(message.chatId);const readiness=calculateReadiness(updated.template,updated.fields);const questions=analyzed.result.nextQuestions.filter(q=>updated.fields[q.fieldId]?.status!=='confirmed').slice(0,3).map((q,i)=>`${i+1}. ${q.text}`);
        return{reply:[t(locale,'saved')(analyzed.result.facts.length),t(locale,'need')(readiness.missing+readiness.needsConfirmation+readiness.conflicts),...questions].join('\n'),brief:updated,messageId:message.id};
      }catch(error){const code=errorCode(error);const locale=await this.repository.getLocale(message.chatId);await this.repository.updateMessage(message.id,{stage:'failed',failedStage:'extracting',errorCode:code});this.event(message,'failed',code);metrics.observe('text_pipeline',Date.now()-started,false);return{reply:t(locale,'temporaryError') as string,brief:current,messageId:message.id,recoverable:true};}
    });
  }
  async progress(chatId:string){const brief=await this.repository.getActive(chatId);const locale=await this.repository.getLocale(chatId);if(!brief)return t(locale,'noBrief') as string;const r=calculateReadiness(brief.template,brief.fields);return[t(locale,'completeness')(r.confirmed,r.required,r.percent),r.needsConfirmation?t(locale,'needsConfirm')(r.needsConfirmation):'',r.conflicts?t(locale,'conflicts')(r.conflicts):''].filter(Boolean).join('\n');}
  async preview(chatId:string):Promise<{html:string;markdown:string;brief:Brief}|undefined>{const brief=await this.repository.getActive(chatId);if(!brief)return;const locale=await this.repository.getLocale(chatId);const markdown=renderFinalMarkdown(brief,locale);await this.repository.preview(brief.id,markdown);return{html:renderOverviewHtml(brief,locale),markdown,brief};}
  async finalize(chatId:string){const preview=await this.preview(chatId);if(!preview)return;const result=await this.repository.finalize(preview.brief.id,preview.markdown);return{markdown:preview.markdown,...result};}
  listBriefs(chatId:string){return this.repository.listBriefs(chatId);}selectBrief(chatId:string,id:string){return this.repository.selectBrief(chatId,id);}createBrief(chatId:string,client:ClientIdentity,title?:string){return this.repository.createBrief(chatId,client,title);}getLocale(chatId:string){return this.repository.getLocale(chatId);}setLocale(chatId:string,locale:Locale){return this.repository.setLocale(chatId,locale);}
  async copyActiveTemplate(chatId:string,name:string){const brief=await this.repository.getActive(chatId);if(!brief)throw new Error('No active brief');const template:TemplateDefinition={...structuredClone(brief.template),key:`custom-${Date.now().toString(36)}`,version:1,name:{ru:name,en:name}};return this.repository.saveTemplateForActive(chatId,template);}
  async configureActiveField(chatId:string,fieldId:string,mode:'required'|'optional'|'off',order?:number){const brief=await this.repository.getActive(chatId);if(!brief)throw new Error('No active brief');const template=structuredClone(brief.template);const field=template.fields.find(f=>f.id===fieldId);if(!field)throw new Error('Unknown field');field.required=mode==='required';field.enabled=mode!=='off';if(order!==undefined)field.order=order;template.version++;return this.repository.saveTemplateForActive(chatId,template);}
  private event(message:StoredMessage,stage:PipelineStage,errorCode?:string){this.emit({requestId:message.id,updateId:message.updateId,briefId:message.briefId,stage,source:message.source,...(errorCode?{errorCode}:{})});}
}
function errorCode(error:unknown):string{const text=String(error);if(/timeout|abort/i.test(text))return'TIMEOUT';if(/429|rate/i.test(text))return'RATE_LIMIT';if(/schema|validation/i.test(text))return'SCHEMA_INVALID';if(/Optimistic lock/i.test(text))return'CONCURRENCY_CONFLICT';return'PROVIDER_UNAVAILABLE';}

import type { Brief, BriefFields, TemplateDefinition } from '../domain/brief.js';
import type { InterviewResult } from '../domain/interview.js';
import type { Locale } from '../domain/localization.js';

export interface DialogueMessage { id: string; role: 'user' | 'assistant'; text: string; }
export interface ClientIdentity { telegramId: string; username?: string; name: string; locale?: Locale; }
export type MessageSource = 'text' | 'voice';
export type PipelineStage = 'received'|'audio_saved'|'transcribing'|'transcribed'|'extracting'|'extracted'|'saving'|'completed'|'failed';
export interface StoredMessage {
  id:string; updateId:number; telegramMessageId:string; chatId:string; briefId:string; sessionId:string; source:MessageSource;
  rawText?:string; telegramFileId?:string; storedFilePath?:string; transcript?:string; language?:string; stage:PipelineStage;
  failedStage?:PipelineStage; errorCode?:string; attempts:number;
}
export interface ModelCallMetadata { task:string; provider:string; model:string; latencyMs:number; inputTokens?:number; outputTokens?:number; costUsd?:number; attempts:number; fallbackReason?:string; }
export interface LLMClient {
  analyze(input: { sessionId?: string; template:TemplateDefinition; brief: BriefFields; message: DialogueMessage; history: DialogueMessage[] }): Promise<{ result: InterviewResult; sessionId: string; model?:ModelCallMetadata }>;
}
export interface TranscriptionResult { text:string; language?:string; confidence?:number; model?:ModelCallMetadata; }
export interface TranscriptionClient { transcribe(filePath: string): Promise<TranscriptionResult>; }

export interface BriefRepository {
  ensureActive(chatId:string,client:ClientIdentity):Promise<Brief>;
  getActive(chatId:string):Promise<Brief|undefined>;
  listBriefs(chatId:string):Promise<Brief[]>;
  createBrief(chatId:string,client:ClientIdentity,title?:string,template?:TemplateDefinition):Promise<Brief>;
  selectBrief(chatId:string,briefId:string):Promise<Brief>;
  renameBrief(chatId:string,briefId:string,title:string):Promise<void>;
  archiveBrief(chatId:string,briefId:string):Promise<void>;
  ingestMessage(input:{updateId:number;telegramMessageId:string;chatId:string;client:ClientIdentity;source:MessageSource;rawText?:string;telegramFileId?:string}):Promise<{message:StoredMessage;brief:Brief;duplicate:boolean}>;
  updateMessage(id:string,patch:{stage?:PipelineStage;storedFilePath?:string;transcript?:string;language?:string;failedStage?:PipelineStage;errorCode?:string;incrementAttempts?:boolean;extracted?:InterviewResult;modelCalls?:ModelCallMetadata[]}):Promise<void>;
  getMessage(id:string):Promise<StoredMessage|undefined>;
  recoverableMessages(limit:number):Promise<StoredMessage[]>;
  history(briefId:string,limit:number):Promise<DialogueMessage[]>;
  applyInterview(briefId:string,expectedVersion:number,messageId:string,result:InterviewResult,sessionId:string,modelCalls?:ModelCallMetadata[]):Promise<Brief>;
  preview(briefId:string,markdown:string):Promise<void>;
  finalize(briefId:string,markdown:string):Promise<{snapshotId:string;brief:Brief}>;
  cancelActive(chatId:string):Promise<void>;
  deleteChatData(chatId:string):Promise<void>;
  audioFilesForChat(chatId:string):Promise<string[]>;
  getLocale(chatId:string):Promise<Locale>;
  setLocale(chatId:string,locale:Locale):Promise<void>;
  saveTemplateForActive(chatId:string,template:TemplateDefinition):Promise<Brief>;
}

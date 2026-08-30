import { and, asc, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import type { Brief, BriefFields, FieldValue, TemplateDefinition } from '../../domain/brief.js';
import { builtInDesignTemplate, calculateProgress } from '../../domain/brief.js';
import type { InterviewResult } from '../../domain/interview.js';
import type { BriefRepository, ClientIdentity, DialogueMessage, ModelCallMetadata, StoredMessage } from '../../application/ports.js';
import type { Locale } from '../../domain/localization.js';
import type { Database } from './client.js';
import { briefFieldHistory, briefFieldValues, briefSessions, briefTemplates, briefs, briefSnapshots, chats, messages, telegramUsers } from './schema.js';

const SESSION_IDLE_MS=30*60*1000;
export class PostgresBriefRepository implements BriefRepository {
  constructor(private readonly db:Database){}

  async ensureActive(chatId:string,client:ClientIdentity):Promise<Brief>{
    const existing=await this.getActive(chatId); if(existing)return existing;
    return this.createBrief(chatId,client);
  }
  async createBrief(chatId:string,client:ClientIdentity,title?:string,template:TemplateDefinition=builtInDesignTemplate):Promise<Brief>{
    return this.db.transaction(async tx=>{
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${chatId}))`);
      const [user]=await tx.insert(telegramUsers).values({telegramId:BigInt(client.telegramId),username:client.username,name:client.name,locale:client.locale??'ru'}).onConflictDoUpdate({target:telegramUsers.telegramId,set:{username:client.username,name:client.name,updatedAt:new Date()}}).returning();
      if(!user)throw new Error('Could not upsert user');
      const [chat]=await tx.insert(chats).values({telegramChatId:BigInt(chatId),userId:user.id}).onConflictDoUpdate({target:chats.telegramChatId,set:{userId:user.id}}).returning();
      if(!chat)throw new Error('Could not upsert chat');
      const fields:BriefFields={};
      const [row]=await tx.insert(briefs).values({chatId:chat.id,title:title?.trim()||template.name[user.locale],shortCode:shortCode(),templateKey:template.key,templateVersion:template.version,templateSnapshot:template,fields,progress:calculateProgress(fields,template)}).returning();
      if(!row)throw new Error('Could not create brief');
      await tx.update(chats).set({activeBriefId:row.id}).where(eq(chats.id,chat.id));
      await tx.insert(briefSessions).values({briefId:row.id});
      return mapBrief(row,chatId);
    });
  }
  async getActive(chatId:string):Promise<Brief|undefined>{
    const [row]=await this.db.select({brief:briefs,telegramChatId:chats.telegramChatId,modelSessionId:briefSessions.modelSessionId}).from(chats).innerJoin(briefs,eq(briefs.id,chats.activeBriefId)).leftJoin(briefSessions,and(eq(briefSessions.briefId,briefs.id),isNull(briefSessions.endedAt))).where(and(eq(chats.telegramChatId,BigInt(chatId)),eq(briefs.status,'active'))).orderBy(desc(briefSessions.startedAt)).limit(1);
    return row?mapBrief(row.brief,row.telegramChatId.toString(),row.modelSessionId??undefined):undefined;
  }
  async listBriefs(chatId:string):Promise<Brief[]>{const rows=await this.db.select({brief:briefs,telegramChatId:chats.telegramChatId}).from(briefs).innerJoin(chats,eq(briefs.chatId,chats.id)).where(eq(chats.telegramChatId,BigInt(chatId))).orderBy(desc(briefs.updatedAt));return rows.map(r=>mapBrief(r.brief,r.telegramChatId.toString()));}
  async selectBrief(chatId:string,briefId:string):Promise<Brief>{
    const [owned]=await this.db.select({brief:briefs,chat:chats}).from(briefs).innerJoin(chats,eq(briefs.chatId,chats.id)).where(and(eq(briefs.id,briefId),eq(chats.telegramChatId,BigInt(chatId)))).limit(1);
    if(!owned||owned.brief.status!=='active')throw new Error('Brief unavailable'); await this.db.update(chats).set({activeBriefId:briefId}).where(eq(chats.id,owned.chat.id)); return mapBrief(owned.brief,chatId);
  }
  async renameBrief(chatId:string,briefId:string,title:string):Promise<void>{const [chat]=await this.db.select().from(chats).where(eq(chats.telegramChatId,BigInt(chatId)));if(!chat)return;await this.db.update(briefs).set({title:title.trim().slice(0,120),updatedAt:new Date()}).where(and(eq(briefs.id,briefId),eq(briefs.chatId,chat.id)));}
  async archiveBrief(chatId:string,briefId:string):Promise<void>{const [chat]=await this.db.select().from(chats).where(eq(chats.telegramChatId,BigInt(chatId)));if(!chat)return;await this.db.transaction(async tx=>{await tx.update(briefs).set({status:'archived',updatedAt:new Date()}).where(and(eq(briefs.id,briefId),eq(briefs.chatId,chat.id)));if(chat.activeBriefId===briefId)await tx.update(chats).set({activeBriefId:null}).where(eq(chats.id,chat.id));});}

  async ingestMessage(input:Parameters<BriefRepository['ingestMessage']>[0]):Promise<{message:StoredMessage;brief:Brief;duplicate:boolean}>{
    const duplicate=await this.db.select().from(messages).where(eq(messages.updateId,BigInt(input.updateId))).limit(1); if(duplicate[0]){const brief=await this.getBriefById(duplicate[0].briefId,input.chatId);return{message:mapMessage(duplicate[0],input.chatId),brief,duplicate:true};}
    return this.db.transaction(async tx=>{
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.chatId}))`);
      const [user]=await tx.insert(telegramUsers).values({telegramId:BigInt(input.client.telegramId),username:input.client.username,name:input.client.name,locale:input.client.locale??'ru'}).onConflictDoUpdate({target:telegramUsers.telegramId,set:{username:input.client.username,name:input.client.name,updatedAt:new Date()}}).returning(); if(!user)throw new Error('User missing');
      let [chat]=await tx.select().from(chats).where(eq(chats.telegramChatId,BigInt(input.chatId))).for('update');
      if(!chat){[chat]=await tx.insert(chats).values({telegramChatId:BigInt(input.chatId),userId:user.id}).returning();} if(!chat)throw new Error('Chat missing');
      let briefRow=chat.activeBriefId?(await tx.select().from(briefs).where(and(eq(briefs.id,chat.activeBriefId),eq(briefs.status,'active'))).limit(1))[0]:undefined;
      if(!briefRow){[briefRow]=await tx.insert(briefs).values({chatId:chat.id,title:builtInDesignTemplate.name[user.locale],shortCode:shortCode(),templateKey:builtInDesignTemplate.key,templateVersion:builtInDesignTemplate.version,templateSnapshot:builtInDesignTemplate,fields:{},progress:0}).returning();if(!briefRow)throw new Error('Brief missing');await tx.update(chats).set({activeBriefId:briefRow.id}).where(eq(chats.id,chat.id));}
      let [session]=await tx.select().from(briefSessions).where(and(eq(briefSessions.briefId,briefRow.id),isNull(briefSessions.endedAt))).orderBy(desc(briefSessions.startedAt)).limit(1);
      if(session&&Date.now()-session.lastActivityAt.getTime()>SESSION_IDLE_MS){await tx.update(briefSessions).set({endedAt:new Date()}).where(eq(briefSessions.id,session.id));session=undefined;}
      if(!session){[session]=await tx.insert(briefSessions).values({briefId:briefRow.id}).returning();}if(!session)throw new Error('Session missing');
      const [row]=await tx.insert(messages).values({updateId:BigInt(input.updateId),telegramMessageId:input.telegramMessageId,chatId:chat.id,userId:user.id,briefId:briefRow.id,sessionId:session.id,source:input.source,rawText:input.rawText,telegramFileId:input.telegramFileId}).onConflictDoNothing().returning();
      if(!row){const [same]=await tx.select().from(messages).where(eq(messages.updateId,BigInt(input.updateId)));if(!same)throw new Error('Message conflict');return{message:mapMessage(same,input.chatId),brief:mapBrief(briefRow,input.chatId),duplicate:true};}
      await tx.update(briefSessions).set({lastActivityAt:new Date()}).where(eq(briefSessions.id,session.id)); return{message:mapMessage(row,input.chatId),brief:mapBrief(briefRow,input.chatId,session.modelSessionId??undefined),duplicate:false};
    });
  }
  async updateMessage(id:string,patch:Parameters<BriefRepository['updateMessage']>[1]):Promise<void>{
    const set:any={updatedAt:new Date()}; if(patch.stage)set.stage=patch.stage;if(patch.storedFilePath)set.storedFilePath=patch.storedFilePath;if(patch.transcript!==undefined)set.transcript=patch.transcript;if(patch.language)set.language=patch.language;if(patch.failedStage)set.failedStage=patch.failedStage;if(patch.errorCode!==undefined)set.errorCode=patch.errorCode;if(patch.extracted)set.extracted=patch.extracted;if(patch.modelCalls)set.modelCalls=patch.modelCalls;if(patch.incrementAttempts){const [row]=await this.db.select({attempts:messages.attempts}).from(messages).where(eq(messages.id,id));set.attempts=(row?.attempts??0)+1;}if(patch.stage==='completed')set.completedAt=new Date();await this.db.update(messages).set(set).where(eq(messages.id,id));
  }
  async getMessage(id:string):Promise<StoredMessage|undefined>{const [row]=await this.db.select({message:messages,chatId:chats.telegramChatId}).from(messages).innerJoin(chats,eq(messages.chatId,chats.id)).where(eq(messages.id,id));return row?mapMessage(row.message,row.chatId.toString()):undefined;}
  async recoverableMessages(limit:number):Promise<StoredMessage[]>{const rows=await this.db.select({message:messages,chatId:chats.telegramChatId}).from(messages).innerJoin(chats,eq(messages.chatId,chats.id)).where(and(eq(messages.stage,'failed'),lt(messages.attempts,3),or(sql`${messages.rawText} is not null`,sql`${messages.transcript} is not null`))).orderBy(asc(messages.updatedAt)).limit(limit);return rows.map(row=>mapMessage(row.message,row.chatId.toString()));}
  async history(briefId:string,limit:number):Promise<DialogueMessage[]>{const rows=await this.db.select().from(messages).where(and(eq(messages.briefId,briefId),eq(messages.role,'user'))).orderBy(desc(messages.receivedAt)).limit(limit);return rows.reverse().map(m=>({id:m.id,role:m.role,text:m.transcript??m.rawText??''}));}
  async applyInterview(briefId:string,expectedVersion:number,messageId:string,result:InterviewResult,sessionId:string,modelCalls:ModelCallMetadata[]=[]):Promise<Brief>{
    return this.db.transaction(async tx=>{
      const [current]=await tx.select().from(briefs).where(eq(briefs.id,briefId)).for('update'); if(!current||current.version!==expectedVersion||current.status!=='active')throw new Error('Optimistic lock conflict');
      const [message]=await tx.select().from(messages).where(and(eq(messages.id,messageId),eq(messages.briefId,briefId))).limit(1);if(!message)throw new Error('Source message missing');const source=(message.transcript??message.rawText??'').toLocaleLowerCase();
      const allowed=new Map(current.templateSnapshot.fields.filter(f=>f.enabled).map(f=>[f.id,f]));const fields={...current.fields};const applied:string[]=[];
      for(const patch of result.facts){const definition=allowed.get(patch.fieldId);if(!definition)continue;if(patch.status==='inferred'&&!definition.modelMayInfer)continue;if(patch.status==='confirmed'&&!source.includes(patch.sourceQuote.toLocaleLowerCase()))continue;
        const previous=fields[patch.fieldId];let next:FieldValue={value:patch.value,status:patch.status,confidence:patch.confidence,sourceMessageIds:[messageId],sourceQuote:patch.sourceQuote,reason:patch.reason,updatedAt:new Date().toISOString()};
        if(previous?.status==='confirmed'&&JSON.stringify(previous.value)!==JSON.stringify(patch.value)&&patch.operation!=='correct')next={...previous,status:'conflicting',reason:`Proposed: ${JSON.stringify(patch.value)}`,sourceMessageIds:[...new Set([...previous.sourceMessageIds,messageId])],updatedAt:new Date().toISOString()};
        if(patch.operation==='confirm'&&previous?.status==='inferred')next={...previous,status:'confirmed',confidence:1,sourceMessageIds:[...new Set([...previous.sourceMessageIds,messageId])],sourceQuote:patch.sourceQuote,reason:patch.reason,updatedAt:new Date().toISOString()};
        fields[patch.fieldId]=next;applied.push(patch.fieldId);await tx.insert(briefFieldHistory).values({briefId,fieldId:patch.fieldId,messageId,previous:previous as any,next:next as any});await tx.insert(briefFieldValues).values({briefId,fieldId:patch.fieldId,value:next.value as any,status:next.status,confidence:String(next.confidence),sourceMessageIds:next.sourceMessageIds,sourceQuote:next.sourceQuote,reason:next.reason,updatedAt:new Date(next.updatedAt)}).onConflictDoUpdate({target:[briefFieldValues.briefId,briefFieldValues.fieldId],set:{value:next.value as any,status:next.status,confidence:String(next.confidence),sourceMessageIds:next.sourceMessageIds,sourceQuote:next.sourceQuote,reason:next.reason,updatedAt:new Date(next.updatedAt)}});
      }
      for(const conflict of result.conflicts){const previous=fields[conflict.fieldId];if(previous)fields[conflict.fieldId]={...previous,status:'conflicting',reason:`Proposed: ${JSON.stringify(conflict.newValue)}`,sourceMessageIds:[...new Set([...previous.sourceMessageIds,messageId])],updatedAt:new Date().toISOString()};}
      const now=new Date();const [updated]=await tx.update(briefs).set({fields,progress:calculateProgress(fields,current.templateSnapshot),version:expectedVersion+1,updatedAt:now}).where(and(eq(briefs.id,briefId),eq(briefs.version,expectedVersion))).returning();if(!updated)throw new Error('Optimistic lock conflict');
      await tx.update(messages).set({stage:'completed',applyResult:{applied},modelCalls,completedAt:now,updatedAt:now,errorCode:null,failedStage:null}).where(eq(messages.id,messageId));
      await tx.update(briefSessions).set({modelSessionId:sessionId,lastActivityAt:now}).where(eq(briefSessions.id,message.sessionId));const [chat]=await tx.select().from(chats).where(eq(chats.id,updated.chatId));return mapBrief(updated,chat!.telegramChatId.toString(),sessionId);
    });
  }
  async preview(briefId:string,markdown:string):Promise<void>{await this.db.update(briefs).set({previewMarkdown:markdown,updatedAt:new Date()}).where(eq(briefs.id,briefId));}
  async finalize(briefId:string,markdown:string):Promise<{snapshotId:string;brief:Brief}>{return this.db.transaction(async tx=>{const [brief]=await tx.select().from(briefs).where(eq(briefs.id,briefId)).for('update');if(!brief||brief.status!=='active')throw new Error('Brief is not active');const ids=await tx.select({id:messages.id}).from(messages).where(eq(messages.briefId,briefId)).orderBy(asc(messages.receivedAt));const [snapshot]=await tx.insert(briefSnapshots).values({briefId,chatId:brief.chatId,templateSnapshot:brief.templateSnapshot,fields:brief.fields,markdown,messageIds:ids.map(x=>x.id)}).returning();const [updated]=await tx.update(briefs).set({status:'finalized',finalizedAt:new Date(),updatedAt:new Date()}).where(eq(briefs.id,briefId)).returning();await tx.update(chats).set({activeBriefId:null}).where(and(eq(chats.id,brief.chatId),eq(chats.activeBriefId,briefId)));const [chat]=await tx.select().from(chats).where(eq(chats.id,brief.chatId));return{snapshotId:snapshot!.id,brief:mapBrief(updated!,chat!.telegramChatId.toString())};});}
  async cancelActive(chatId:string):Promise<void>{const active=await this.getActive(chatId);if(active)await this.archiveBrief(chatId,active.id);}
  async deleteChatData(chatId:string):Promise<void>{await this.db.transaction(async tx=>{const [chat]=await tx.select().from(chats).where(eq(chats.telegramChatId,BigInt(chatId)));if(!chat)return;await tx.delete(chats).where(eq(chats.id,chat.id));const [other]=await tx.select().from(chats).where(eq(chats.userId,chat.userId)).limit(1);if(!other)await tx.delete(telegramUsers).where(eq(telegramUsers.id,chat.userId));});}
  async audioFilesForChat(chatId:string):Promise<string[]>{const rows=await this.db.select({path:messages.storedFilePath}).from(messages).innerJoin(chats,eq(messages.chatId,chats.id)).where(eq(chats.telegramChatId,BigInt(chatId)));return rows.flatMap(row=>row.path?[row.path]:[]);}
  async getLocale(chatId:string):Promise<Locale>{const [row]=await this.db.select({locale:telegramUsers.locale}).from(chats).innerJoin(telegramUsers,eq(chats.userId,telegramUsers.id)).where(eq(chats.telegramChatId,BigInt(chatId)));return row?.locale??'ru';}
  async setLocale(chatId:string,locale:Locale):Promise<void>{const [chat]=await this.db.select().from(chats).where(eq(chats.telegramChatId,BigInt(chatId)));if(chat)await this.db.update(telegramUsers).set({locale,updatedAt:new Date()}).where(eq(telegramUsers.id,chat.userId));}
  async saveTemplateForActive(chatId:string,template:TemplateDefinition):Promise<Brief>{return this.db.transaction(async tx=>{await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${chatId}))`);const [chat]=await tx.select().from(chats).where(eq(chats.telegramChatId,BigInt(chatId))).for('update');if(!chat?.activeBriefId)throw new Error('No active brief');const [current]=await tx.select().from(briefs).where(and(eq(briefs.id,chat.activeBriefId),eq(briefs.chatId,chat.id))).for('update');if(!current)throw new Error('No active brief');await tx.insert(briefTemplates).values({ownerUserId:chat.userId,key:template.key,version:template.version,definition:template,builtIn:false}).onConflictDoNothing();const [updated]=await tx.update(briefs).set({templateKey:template.key,templateVersion:template.version,templateSnapshot:template,progress:calculateProgress(current.fields,template),version:current.version+1,updatedAt:new Date()}).where(eq(briefs.id,current.id)).returning();return mapBrief(updated!,chatId);});}
  private async getBriefById(id:string,chatId:string):Promise<Brief>{const [row]=await this.db.select().from(briefs).where(eq(briefs.id,id));if(!row)throw new Error('Brief missing');return mapBrief(row,chatId);}
}
function shortCode():string{return randomBytes(3).toString('hex').toUpperCase();}
function mapBrief(row:typeof briefs.$inferSelect,chatId:string,modelSessionId?:string):Brief{return{id:row.id,chatId,title:row.title,shortCode:row.shortCode,status:row.status,template:row.templateSnapshot,fields:row.fields,progress:row.progress,version:row.version,createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString(),...(modelSessionId?{opencodeSessionId:modelSessionId}:{})};}
function mapMessage(row:typeof messages.$inferSelect,chatId:string):StoredMessage{return{id:row.id,updateId:Number(row.updateId),telegramMessageId:row.telegramMessageId,chatId,briefId:row.briefId,sessionId:row.sessionId,source:row.source,stage:row.stage,attempts:row.attempts,...(row.rawText?{rawText:row.rawText}:{}),...(row.telegramFileId?{telegramFileId:row.telegramFileId}:{}),...(row.storedFilePath?{storedFilePath:row.storedFilePath}:{}),...(row.transcript?{transcript:row.transcript}:{}),...(row.language?{language:row.language}:{}),...(row.failedStage?{failedStage:row.failedStage}:{}),...(row.errorCode?{errorCode:row.errorCode}:{})};}

import type { LLMClient } from '../../application/ports.js';
import type { InterviewResult } from '../../domain/interview.js';
export class RuleBasedDemoLLM implements LLMClient {
  async analyze(input:Parameters<LLMClient['analyze']>[0]):ReturnType<LLMClient['analyze']>{
    const text=input.message.text;const facts:InterviewResult['facts']=[];
    const add=(fieldId:string,match:RegExpMatchArray|null,status:'confirmed'|'skipped'='confirmed')=>{if(match)facts.push({fieldId,value:(match[1]??match[0]).trim(),operation:'set',status,confidence:1,sourceQuote:match[0],reason:'demo rule',sourceMessageIds:[input.message.id]});};
    add('business.product',text.match(/(?:запускаем|product is)\s+([^.!]+)/i));add('business.siteGoal',text.match(/цель\s*[—:-]\s*([^.!]+)/i));add('audience.primarySegments',text.match(/аудитория\s*[—:-]\s*([^.!]+)/i));add('scope.siteType',text.match(/(?:нужен|need a)\s+(лендинг|landing page)/i));add('visualDirection.impression',text.match(/(?:нравятся|style is)\s+([^.!]+)/i));add('content.readiness',text.match(/контент\s+([^.!]+)/i));add('constraints.budget',text.match(/бюджет\s+([^,!\n]+)/i),/не определ/i.test(text)?'skipped':'confirmed');add('constraints.launchDate',text.match(/запуск\s+([^.!]+)/i));add('approvalProcess.finalDecisionMaker',text.match(/решение\s+([^.!]+)/i));
    return Promise.resolve({sessionId:input.sessionId??'demo-session',result:{facts,conflicts:[],nextQuestions:[],detectedLanguage:/[а-яё]/i.test(text)?'ru':'en'}});
  }
}

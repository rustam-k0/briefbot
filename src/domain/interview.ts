import { z } from 'zod';
import { fieldStatusSchema, type TemplateDefinition } from './brief.js';

export const patchSchema = z.object({
  fieldId: z.string().min(1), value: z.unknown(),
  operation: z.enum(['set', 'correct', 'confirm']),
  status: fieldStatusSchema.exclude(['missing', 'conflicting']), confidence: z.number().min(0).max(1),
  sourceQuote: z.string().min(1).max(1000), reason: z.string().min(1).max(1000), sourceMessageIds: z.array(z.string()).default([]),
});
export const interviewResultSchema = z.object({
  facts: z.array(patchSchema),
  conflicts: z.array(z.object({ fieldId: z.string(), previousValue: z.unknown(), newValue: z.unknown(), sourceQuote: z.string(), question: z.string() })),
  nextQuestions: z.array(z.object({ fieldId: z.string(), text: z.string() })).max(3),
  detectedLanguage: z.enum(['ru', 'en', 'mixed']),
});
export type InterviewResult = z.infer<typeof interviewResultSchema>;

export function interviewJsonSchema(template: TemplateDefinition) {
  const ids = template.fields.filter((field) => field.enabled).map((field) => field.id);
  const patch = { type:'object', additionalProperties:false, required:['fieldId','value','operation','status','confidence','sourceQuote','reason','sourceMessageIds'], properties:{
    fieldId:{ enum:ids }, value:{}, operation:{enum:['set','correct','confirm']}, status:{ enum:['confirmed','inferred','skipped','not_applicable'] }, confidence:{ type:'number', minimum:0, maximum:1 },
    sourceQuote:{ type:'string' }, reason:{ type:'string' }, sourceMessageIds:{ type:'array', items:{ type:'string' } },
  }};
  return { type:'object', additionalProperties:false, required:['facts','conflicts','nextQuestions','detectedLanguage'], properties:{
    facts:{ type:'array', items:patch }, conflicts:{ type:'array', items:{ type:'object', additionalProperties:false, required:['fieldId','previousValue','newValue','sourceQuote','question'], properties:{ fieldId:{enum:ids}, previousValue:{}, newValue:{}, sourceQuote:{type:'string'}, question:{type:'string'} } } },
    nextQuestions:{ type:'array', maxItems:3, items:{ type:'object', additionalProperties:false, required:['fieldId','text'], properties:{fieldId:{enum:ids},text:{type:'string'}} } }, detectedLanguage:{enum:['ru','en','mixed']},
  }} as const;
}

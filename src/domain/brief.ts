import { z } from 'zod';

export const fieldStatusSchema = z.enum(['confirmed', 'inferred', 'missing', 'conflicting', 'skipped', 'not_applicable']);
export type FieldStatus = z.infer<typeof fieldStatusSchema>;

export const fieldValueSchema = z.object({
  value: z.unknown(),
  status: fieldStatusSchema,
  confidence: z.number().min(0).max(1),
  sourceMessageIds: z.array(z.string()),
  sourceQuote: z.string().max(1000).optional(),
  reason: z.string().max(1000).optional(),
  updatedAt: z.string().datetime(),
});
export type FieldValue = z.infer<typeof fieldValueSchema>;
export type FieldPath = string;
export type BriefFields = Record<FieldPath, FieldValue | undefined>;

export const templateFieldSchema = z.object({
  id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.-]{0,127}$/),
  sectionId: z.string().min(1),
  label: z.object({ ru: z.string().min(1), en: z.string().min(1) }),
  type: z.enum(['text', 'long_text', 'number', 'date', 'boolean', 'single_choice', 'multi_choice', 'url']),
  required: z.boolean(),
  weight: z.number().positive().default(1),
  modelMayInfer: z.boolean().default(false),
  requiresConfirmation: z.boolean().default(false),
  enabled: z.boolean().default(true),
  order: z.number().int(),
  options: z.array(z.string()).optional(),
  validation: z.object({ minLength: z.number().int().nonnegative().optional(), maxLength: z.number().int().positive().optional(), pattern: z.string().optional() }).optional(),
  dependsOn: z.object({ fieldId: z.string(), equals: z.unknown() }).optional(),
  hint: z.object({ ru: z.string(), en: z.string() }).optional(),
});
export const templateSectionSchema = z.object({
  id: z.string().min(1), title: z.object({ ru: z.string(), en: z.string() }), order: z.number().int(), enabled: z.boolean().default(true),
});
export const templateDefinitionSchema = z.object({
  key: z.string().min(1), version: z.number().int().positive(),
  name: z.object({ ru: z.string(), en: z.string() }), description: z.object({ ru: z.string(), en: z.string() }),
  sections: z.array(templateSectionSchema), fields: z.array(templateFieldSchema),
});
export type TemplateDefinition = z.infer<typeof templateDefinitionSchema>;

export type BriefStatus = 'active' | 'finalized' | 'archived' | 'cancelled';
export interface Brief {
  id: string; chatId: string; title: string; shortCode: string; status: BriefStatus;
  template: TemplateDefinition; fields: BriefFields; progress: number; opencodeSessionId?: string;
  version: number; createdAt: string; updatedAt: string;
}

export interface Readiness {
  confirmed: number; required: number; percent: number; needsConfirmation: number; conflicts: number; missing: number;
}

function applicable(field: TemplateDefinition['fields'][number], fields: BriefFields): boolean {
  if (!field.enabled) return false;
  if (!field.dependsOn) return true;
  return fields[field.dependsOn.fieldId]?.value === field.dependsOn.equals;
}

export function calculateReadiness(template: TemplateDefinition, fields: BriefFields): Readiness {
  const required = template.fields.filter((field) => field.required && applicable(field, fields) && fields[field.id]?.status !== 'not_applicable');
  const totalWeight = required.reduce((sum, field) => sum + field.weight, 0);
  const confirmedWeight = required.reduce((sum, field) => sum + (fields[field.id]?.status === 'confirmed' ? field.weight : 0), 0);
  return {
    confirmed: required.filter((field) => fields[field.id]?.status === 'confirmed').length,
    required: required.length,
    percent: totalWeight ? Math.round((confirmedWeight / totalWeight) * 100) : 100,
    needsConfirmation: required.filter((field) => fields[field.id]?.status === 'inferred').length,
    conflicts: required.filter((field) => fields[field.id]?.status === 'conflicting').length,
    missing: required.filter((field) => !fields[field.id] || fields[field.id]?.status === 'missing').length,
  };
}

export function calculateProgress(fields: BriefFields, template: TemplateDefinition = builtInDesignTemplate): number {
  return calculateReadiness(template, fields).percent;
}

export function readinessGaps(fields: BriefFields, template: TemplateDefinition = builtInDesignTemplate): string[] {
  return template.fields.filter((field) => field.required && applicable(field, fields) && fields[field.id]?.status !== 'confirmed')
    .map((field) => field.label.ru);
}

const sections = [
  ['business', 'Бизнес и продукт', 'Business and product'], ['audience', 'Аудитория', 'Audience'],
  ['scope', 'Объём работ', 'Scope'], ['functionality', 'Функции', 'Functionality'],
  ['content', 'Контент', 'Content'], ['visual', 'Визуальное направление', 'Visual direction'],
  ['constraints', 'Сроки и бюджет', 'Timeline and budget'], ['approval', 'Согласование', 'Approval'],
] as const;
const f = (id: string, sectionId: string, ru: string, en: string, required: boolean, order: number, modelMayInfer = false) => ({
  id, sectionId, label: { ru, en }, type: 'long_text' as const, required, weight: 1, modelMayInfer,
  requiresConfirmation: modelMayInfer, enabled: true, order,
});
export const builtInDesignTemplate: TemplateDefinition = templateDefinitionSchema.parse({
  key: 'website-design', version: 1,
  name: { ru: 'Бриф на сайт', en: 'Website brief' },
  description: { ru: 'Цели, аудитория, объём, стиль, сроки и бюджет', en: 'Goals, audience, scope, style, timeline and budget' },
  sections: sections.map(([id, ru, en], order) => ({ id, title: { ru, en }, order, enabled: true })),
  fields: [
    f('business.projectName','business','Название проекта','Project name',false,0), f('business.product','business','Продукт или услуга','Product or service',true,1),
    f('business.siteGoal','business','Цель сайта','Website goal',true,2), f('business.successMetrics','business','Критерии успеха','Success metrics',false,3),
    f('audience.primarySegments','audience','Основная аудитория','Primary audience',true,0), f('audience.needs','audience','Потребности аудитории','Audience needs',false,1),
    f('scope.siteType','scope','Формат сайта','Website type',true,0,true), f('scope.pages','scope','Страницы','Pages',true,1),
    f('scope.responsiveVersions','scope','Адаптивность','Responsive versions',false,2,true),
    f('functionality.forms','functionality','Способ получения заявок','Lead capture',true,0), f('functionality.integrations','functionality','Интеграции','Integrations',false,1),
    f('content.readiness','content','Готовность контента','Content readiness',true,0), f('content.owner','content','Кто готовит контент','Content owner',false,1),
    f('visualDirection.impression','visual','Желаемое впечатление','Desired impression',true,0), f('visualDirection.likedSites','visual','Референсы','References',false,1),
    f('constraints.launchDate','constraints','Срок запуска','Launch date',true,0), f('constraints.budget','constraints','Бюджет','Budget',true,1),
    f('approvalProcess.finalDecisionMaker','approval','Кто принимает решение','Final decision maker',true,0),
  ],
});

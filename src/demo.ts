import { InterviewService } from './application/interview-service.js';
import { InMemoryBriefRepository } from './infrastructure/demo/in-memory-repository.js';
import { RuleBasedDemoLLM } from './infrastructure/demo/rule-based-llm.js';

const repository = new InMemoryBriefRepository();
const service = new InterviewService(repository, new RuleBasedDemoLLM());
const client = { telegramId: '1001', username: 'demo', name: 'Демо-клиент' };
const messages = [
  'Мы запускаем доставку фермерских продуктов в Берлине. Нужен лендинг, цель — получить 100 заявок в первый месяц.',
  'Аудитория — занятые специалисты 25–45 лет. Нравятся спокойные натуральные цвета. Контент готов наполовину.',
  'Бюджет пока не определён, запуск желательно в ноябре. Решение принимаю я.',
];
for (const [index, text] of messages.entries()) {
  const result = await service.process(index + 1, '1001', client, String(index + 1), text);
  console.log(`Клиент: ${text}\nБот: ${result.reply}\n`);
}
console.log((await service.preview('1001'))?.markdown);

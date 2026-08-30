export const modelRouting={
  language_detection:{strategy:'deterministic_unicode',models:[]},
  transcription:{strategy:'fallback',models:['qwen3-asr-flash','qwen-audio-3.0-asr-flash']},
  transcript_normalization:{strategy:'asr_itn',models:[]},
  fact_extraction:{strategy:'fallback',models:['qwen3.8-flash','qwen3.7-plus']},
  field_mapping:{strategy:'json_schema_and_code',models:[]},conflict_detection:{strategy:'deterministic_merge',models:[]},
  question_planning:{strategy:'same_extraction_call',models:['qwen3.8-flash','qwen3.7-plus']},
  summary:{strategy:'deterministic',models:[]},final_editing:{strategy:'deterministic',models:[]},translation:{strategy:'disabled',models:[]},
} as const;

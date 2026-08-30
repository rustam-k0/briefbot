export const modelRouting={
  language_detection:{strategy:'deterministic_unicode',models:[]},
  transcription:{strategy:'local',models:['Systran/faster-whisper-small']},
  transcript_normalization:{strategy:'asr_itn',models:[]},
  fact_extraction:{strategy:'fallback',models:['opencode-go/qwen3.8-flash','opencode-go/qwen3.7-plus']},
  field_mapping:{strategy:'json_schema_and_code',models:[]},conflict_detection:{strategy:'deterministic_merge',models:[]},
  question_planning:{strategy:'same_extraction_call',models:['opencode-go/qwen3.8-flash','opencode-go/qwen3.7-plus']},
  summary:{strategy:'deterministic',models:[]},final_editing:{strategy:'deterministic',models:[]},translation:{strategy:'disabled',models:[]},
} as const;

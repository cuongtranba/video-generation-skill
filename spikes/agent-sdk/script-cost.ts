import { query } from '@anthropic-ai/claude-agent-sdk'

const schema = {
  type: 'object',
  properties: { scenes: { type: 'array', items: { type: 'object',
    properties: { narration: { type: 'string' }, visual: { type: 'string' } },
    required: ['narration', 'visual'] } } },
  required: ['scenes'],
} as const

const ideas = [
  '3 lý do bạn nên uống nước ấm mỗi sáng',
  '5 mẹo tiết kiệm pin điện thoại',
  'Cách pha cà phê phin ngon tại nhà',
]

for (const idea of ideas) {
  let cost = 0, scenes = 0
  for await (const message of query({
    prompt: `Viết kịch bản video dọc 30 giây (3 cảnh) cho ý tưởng: "${idea}". Mỗi cảnh có lời thoại tiếng Việt (narration) và ghi chú hình ảnh (visual).`,
    options: { outputFormat: { type: 'json_schema', schema } },
  })) {
    if (message.type === 'result') {
      cost = message.total_cost_usd ?? 0
      const out = message.structured_output as { scenes?: unknown[] } | undefined
      scenes = out?.scenes?.length ?? 0
    }
  }
  console.log(JSON.stringify({ idea, scriptUsd: cost, scenes }))
}

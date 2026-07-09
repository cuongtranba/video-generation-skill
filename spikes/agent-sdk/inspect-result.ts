import { query } from '@anthropic-ai/claude-agent-sdk'

const schema = {
  type: 'object',
  properties: { scenes: { type: 'array', items: { type: 'object',
    properties: { narration: { type: 'string' }, visual: { type: 'string' } },
    required: ['narration', 'visual'] } } },
  required: ['scenes'],
} as const

for await (const message of query({
  prompt: `Viết kịch bản video dọc 30 giây (3 cảnh) cho ý tưởng: "3 lý do bạn nên uống nước ấm mỗi sáng". Mỗi cảnh có lời thoại tiếng Việt (narration) và ghi chú hình ảnh (visual).`,
  options: { outputFormat: { type: 'json_schema', schema } },
})) {
  if (message.type === 'result') {
    console.log(JSON.stringify(message, null, 2))
  }
}

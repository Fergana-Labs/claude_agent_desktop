import { query } from '@anthropic-ai/claude-agent-sdk';

console.log('Testing SDK WITHOUT resume...');

const options = {
  model: 'claude-sonnet-4-5-20250929',
  maxThinkingTokens: 10000,
  cwd: '/Users/samliu/Downloads/Henry Docs',
  settingSources: ['user', 'project'],
  allowedTools: ['Skill', 'Read', 'Write', 'Bash'],
  resume: undefined, // NO RESUME
  env: {
    PATH: process.env.PATH,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  },
};

console.log('Options:', JSON.stringify(options, null, 2));

async function* messageGenerator() {
  yield {
    type: 'user',
    session_id: 'new-session',
    message: {
      role: 'user',
      content: 'Does this work'
    },
    parent_tool_use_id: null,
  };
}

try {
  console.log('Starting query...');
  const q = query({ prompt: messageGenerator(), options });

  let tokenCount = 0;
  for await (const message of q) {
    if (message.type === 'stream_event') {
      tokenCount++;
      if (tokenCount <= 5) {
        console.log('Received stream event');
      }
    } else {
      console.log('Received message:', message.type);
    }
  }

  console.log('Query completed successfully!');
} catch (error) {
  console.error('ERROR:', error.message);
  console.error('Stack:', error.stack);
}

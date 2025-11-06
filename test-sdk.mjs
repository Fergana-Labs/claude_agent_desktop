import { query } from '@anthropic-ai/claude-agent-sdk';

console.log('Testing SDK with the same parameters that are failing...');

const options = {
  model: 'claude-sonnet-4-5-20250929',
  maxThinkingTokens: 10000,
  cwd: '/Users/samliu/Downloads/Henry Docs',
  settingSources: ['user', 'project'],
  allowedTools: ['Skill', 'Read', 'Write', 'Bash'],
  resume: 'dbb82278-b358-48f8-887e-df8bcd4afba2',
  env: {
    PATH: process.env.PATH,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  },
};

console.log('Options:', JSON.stringify(options, null, 2));

async function* messageGenerator() {
  yield {
    type: 'user',
    session_id: 'dbb82278-b358-48f8-887e-df8bcd4afba2',
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

  for await (const message of q) {
    console.log('Received message:', message.type);
  }

  console.log('Query completed successfully!');
} catch (error) {
  console.error('ERROR:', error.message);
  console.error('Stack:', error.stack);
  console.error('Error name:', error.name);
  console.error('Full error:', JSON.stringify(error, null, 2));
}

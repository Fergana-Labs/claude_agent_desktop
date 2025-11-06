import { query } from '@anthropic-ai/claude-agent-sdk';

// Set API key
process.env.ANTHROPIC_API_KEY = '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';

console.log('Testing Claude Agent SDK...');
console.log('API key set:', !!process.env.ANTHROPIC_API_KEY);

try {
  const result = query({
    prompt: 'Hello! Just say "hi" back to test the connection.',
    options: {
      model: 'claude-sonnet-4-5-20250929',
    }
  });

  console.log('Query started, waiting for response...');

  for await (const message of result) {
    console.log('Message type:', message.type);

    if (message.type === 'assistant' && message.message) {
      console.log('Assistant response:', message.message.content);
    }
  }

  console.log('✅ SDK test successful!');
  process.exit(0);
} catch (error) {
  console.error('❌ SDK test failed:', error.message);
  console.error('Full error:', error);
  process.exit(1);
}

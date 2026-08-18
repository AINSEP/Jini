import { createUIResource } from '@mcp-ui/server';
import { writeFileSync } from 'node:fs';

const html = [
  '<!doctype html>',
  '<html>',
  '  <body style="font-family: sans-serif; margin: 0; padding: 16px;">',
  '    <h1 data-testid="poc-card-heading">Real MCP-UI checkbox card</h1>',
  '    <label><input type="checkbox" data-testid="cb-newsletter" /> Subscribe to newsletter</label><br/>',
  '    <p>Pick one:</p>',
  '    <label><input type="radio" name="plan" value="free" data-testid="radio-free" checked /> Free</label><br/>',
  '    <label><input type="radio" name="plan" value="pro" data-testid="radio-pro" /> Pro</label>',
  '  </body>',
  '</html>',
].join('\n');

const resource = createUIResource({
  uri: 'ui://jini-poc/checkbox-e2e-card',
  content: { type: 'rawHtml', htmlString: html },
  encoding: 'text',
});

writeFileSync(new URL('./resource.json', import.meta.url), JSON.stringify(resource, null, 2));
console.log('Resource written. mimeType:', resource.resource.mimeType, 'text length:', resource.resource.text.length);

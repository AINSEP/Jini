import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { McpUiOfficialSwapLab } from './McpUiOfficialSwapLab.js';
import './remixicon.css';
import './styles.css';

/** Entry point for `verify-mcpui-swap.html` — see that file's own comment for why it's standalone. */
const root = document.getElementById('root');
if (!root) throw new Error('verify-mcpui-swap could not find #root');

createRoot(root).render(
  <StrictMode>
    <McpUiOfficialSwapLab />
  </StrictMode>,
);

/** The core asset owns effective state and context; optional features arrive separately. */
import { bootWithContext } from './client/runtime.js';
void bootWithContext(window);

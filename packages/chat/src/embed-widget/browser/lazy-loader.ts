/** Shared bubble styles for server placeholders and mounted DOM widgets; no runtime dependencies. */
export const CHAT_BUBBLE_STYLE = '.jini-chat-bubble{position:fixed;right:var(--jini-embed-right,24px);bottom:24px;width:56px;height:56px;border:0;border-radius:50%;background:var(--jini-chat-accent,var(--color-primary,#2563eb));color:var(--jini-chat-accent-text,#fff);box-shadow:0 4px 16px #0003;cursor:pointer;z-index:var(--jini-embed-z-index,1000);display:grid;place-items:center}\n.jini-chat-bubble[hidden]{display:none!important}\n.jini-chat-bubble svg{width:24px;height:24px}\n.jini-chat-bubble:focus-visible{outline:3px solid var(--jini-chat-accent,#2563eb);outline-offset:3px}\n@media(max-width:480px){.jini-chat-bubble{right:16px;bottom:16px}}\n.jini-chat-bubble[aria-busy="true"]{cursor:progress;opacity:.65}\n.jini-chat-bubble[data-load-failed="true"]{outline:2px solid var(--jini-chat-error,#b91c1c);outline-offset:3px}';

export interface LazyChatLoaderArgs {
  readonly button: HTMLButtonElement;
  readonly load: (args: Record<string, never>) => Promise<void>;
  readonly open: (args: { focus?: boolean }) => void;
  readonly resume: boolean;
  readonly deepLink: boolean;
  readonly preload?: boolean;
  readonly loadingLabel: string;
  readonly retryLabel: string;
}

/**
 * Activates a host-rendered button without importing chat, React, icons or storage.
 * One in-flight load serves repeated activation; failures remain retryable. Native button
 * keyboard activation also emits click; preventDefault avoids a second toggle after keydown.
 */
export function installLazyChatLoader(args: LazyChatLoaderArgs, _options = {}) {
  let pending: Promise<void> | null = null;
  let ready = false;
  let disposed = false;
  let shouldOpen = false;
  let shouldFocus = false;
  const initialContent = args.button.innerHTML;
  const label = args.button.getAttribute('aria-label') ?? '';
  const activate = async ({ open = true, focus = open }: { open?: boolean; focus?: boolean } = {}, _options = {}): Promise<void> => {
    if (disposed) return;
    if (!pending) { shouldOpen = false; shouldFocus = false; }
    shouldOpen ||= open;
    shouldFocus ||= focus;
    if (pending) return pending;
    args.button.setAttribute('aria-busy', 'true');
    args.button.setAttribute('aria-label', args.loadingLabel);
    args.button.textContent = args.loadingLabel;
    delete args.button.dataset.loadFailed;
    // Defer through a promise so a synchronous host load failure follows the same retry path.
    pending = Promise.resolve().then(() => { if (!ready) return args.load({}); }).then(() => {
      if (disposed) return;
      // Asset readiness survives an open failure; retry must never evaluate the script twice.
      ready = true;
      if (shouldOpen) args.open({ focus: shouldFocus });
      args.button.setAttribute('aria-label', label);
      args.button.innerHTML = initialContent;
      args.button.hidden = true;
    }).catch(() => {
      if (!disposed) {
        args.button.hidden = false;
        args.button.dataset.loadFailed = 'true';
        args.button.setAttribute('aria-label', args.retryLabel);
        args.button.textContent = args.retryLabel;
      }
    }).finally(() => {
      pending = null;
      args.button.removeAttribute('aria-busy');
    });
    return pending;
  };
  const click = () => { void activate({}); };
  const keydown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    void activate({});
  };
  args.button.addEventListener('click', click);
  args.button.addEventListener('keydown', keydown);
  args.button.dataset.loaderReady = 'true';
  if (args.resume || args.deepLink) void activate({ focus: args.deepLink });
  else if (args.preload) void activate({ open: false });
  return {
    activate,
    dispose(_input: Record<string, never> = {}, _options = {}) {
      disposed = true;
      args.button.removeEventListener('click', click);
      args.button.removeEventListener('keydown', keydown);
      args.button.setAttribute('aria-label', label);
      args.button.innerHTML = initialContent;
      args.button.removeAttribute('aria-busy');
      delete args.button.dataset.loadFailed;
      delete args.button.dataset.loaderReady;
    },
  };
}

/** Loads CSS before a self-mounting classic script; failed elements are removed for retry. */
export async function loadChatAssets({ document, scriptUrl, styleUrl, mount }: {
  document: Document; scriptUrl: string; styleUrl: string; mount?: HTMLElement;
}, _options = {}): Promise<void> {
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = styleUrl;
  const script = document.createElement('script');
  script.src = scriptUrl;
  const loaded = (element: HTMLLinkElement | HTMLScriptElement) => new Promise<void>((resolve, reject) => {
    element.onload = () => resolve();
    element.onerror = () => reject(new Error('Chat assets could not be loaded'));
    document.head.appendChild(element);
  });
  try {
    await loaded(stylesheet);
    await loaded(script);
    // A classic script's load event proves evaluation, not React commit or a successful mount.
    // Optional for legacy hosts; lazy visitor hosts supply their root as the readiness boundary.
    if (mount && mount.dataset.chatMounted !== 'true') {
      await new Promise<void>((resolve, reject) => {
        const ready = () => { cleanup(); resolve(); };
        const timeout = setTimeout(() => { cleanup(); reject(new Error('Chat widget did not mount')); }, 10_000);
        const cleanup = () => { clearTimeout(timeout); mount.removeEventListener('jini-chat-mounted', ready); };
        mount.addEventListener('jini-chat-mounted', ready);
      });
    }
  }
  catch (error) { stylesheet.remove(); script.remove(); throw error; }
}

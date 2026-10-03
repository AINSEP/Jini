import { agentHandle as handleProps } from '@jini-ai/agentic';

export interface ComingSoonNoticeProps {
  kicker: string;
  label: string;
  /** Fully translated description supplied by the host. */
  description: string;
  note?: string | undefined;
  agentHandle?: string | undefined;
}

/** A notice without navigation lookup, route knowledge, or locale state. */
export function ComingSoonNotice({ kicker, label, description, note, agentHandle }: ComingSoonNoticeProps) {
  return (
    <div className="coming-soon-notice" {...(agentHandle ? handleProps({ handle: agentHandle }, { role: 'status', label }) : {})}>
      <div className="coming-soon-notice-header">
        <p className="coming-soon-notice-kicker">{kicker}</p>
        <h1>{label}</h1>
        <p>{description}</p>
        {note ? <p>{note}</p> : null}
      </div>
    </div>
  );
}

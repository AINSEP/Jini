/** Get both IPC channel names from a required, caller-owned namespace. */
export function speechChannels({ channelNamespace }: { channelNamespace: string }): { isAvailable: string; transcribe: string } {
  return { isAvailable: `${channelNamespace}:isAvailable`, transcribe: `${channelNamespace}:transcribe` };
}

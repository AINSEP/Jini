export type {
  MentionEntity,
  MentionPart,
  MentionInsert,
  CaretRect,
  RichTextTriggerAnchor,
  RichTextTriggerConfig,
  RichTextTriggerMatch,
  PopoverNavigationKey,
  SerializedRichText,
  RichTextInputHandle,
} from './types.js';

export { DEFAULT_TRIGGERS, DEFAULT_TEST_ID } from './constants.js';

export {
  buildMentionToken,
  parseMentionParts,
  isMentionBoundary,
  isMentionRightBoundary,
  mentionTokenPresent,
  foldPresentMentions,
} from './mention-parser.js';

export {
  MentionNode,
  $createMentionNode,
  $isMentionNode,
  type MentionPayload,
  type SerializedMentionNode,
} from './mention-node.js';

export { serializeRichText } from './serialize.js';
export { setRichTextFromPlainText } from './deserialize.js';

export {
  detectActiveTrigger,
  buildTriggerDeletionRegex,
  buildAnyTriggerDeletionRegex,
  buildTriggerMatch,
  readCaretRect,
  computeCaretFloatingLayerPosition,
  type CaretFloatingLayerPosition,
} from './rules.js';

export { RichTextInput, type RichTextInputProps } from './react/components/RichTextInput.js';
export {
  CaretFloatingLayer,
  type CaretFloatingLayerProps,
} from './react/components/CaretFloatingLayer.js';
export {
  useMentionColorStamping,
  MENTION_COLOR_PROPERTY,
} from './react/hooks/useMentionColorStamping.js';
export { useCaretFloatingLayerPosition } from './react/hooks/useCaretFloatingLayerPosition.js';

import React from "react";
import {interpolate, spring, useCurrentFrame, useVideoConfig} from "remotion";
import {AvatarImage, avatarSrcFor} from "./avatarLibrary";
import type {ChatSpec} from "./types";

const CONTAINER_THEME = {
  none: {screenBg: "transparent", headerBg: "transparent", bubbleLeft: "#FFFFFF", bubbleRight: "#F4F5F7", subtitle: "#7C7C7C"},
  wechat: {screenBg: "#EDEDED", headerBg: "#EDEDED", bubbleLeft: "#FFFFFF", bubbleRight: "#95EC69", subtitle: "#9A9A9A"},
  telegram: {screenBg: "#DDE8F6", headerBg: "#F5F8FC", bubbleLeft: "#FFFFFF", bubbleRight: "#E2F3FF", subtitle: "#7B8EA5"},
  messenger: {screenBg: "#F3F5F8", headerBg: "#FFFFFF", bubbleLeft: "#FFFFFF", bubbleRight: "#0A84FF", subtitle: "#7E8695"},
} as const;

const CHAT_WIDTH = 780;
const ROW_MAX_WIDTH_RATIO = 0.86;
const AVATAR_SIZE = 62;
const AVATAR_GAP = 12;
const BUBBLE_HORIZONTAL_PADDING = 44;
const BUBBLE_WIDTH_SAFETY = 18;
const BUBBLE_FONT_SIZE = 30;
const BUBBLE_FONT_WEIGHT = 500;
const FONT_FAMILY = `"PingFang SC", "Alibaba PuHuiTi", "Noto Sans SC", sans-serif`;
const CANVAS_CACHE_KEY = "__chat_motion_overlay_measure_canvas__";

const estimateCharWidth = (char: string) => {
  if (/\s/.test(char)) return BUBBLE_FONT_SIZE * 0.35;
  if (/[\u0000-\u00ff]/.test(char)) return BUBBLE_FONT_SIZE * 0.58;
  return BUBBLE_FONT_SIZE * 1.02;
};

const estimateTextWidth = ({text}: {text: string}) =>
  Array.from(text).reduce((sum, char) => sum + estimateCharWidth(char), 0);

/** The cached 2d context used to measure bubble text, or null when no canvas is available (SSR, detached document). */
const measuringContext = () => {
  if (typeof document === "undefined") return null;
  const win = document.defaultView as (Window & {[CANVAS_CACHE_KEY]?: HTMLCanvasElement}) | null;
  if (!win) return null;
  const canvas = win[CANVAS_CACHE_KEY] ?? document.createElement("canvas");
  if (!win[CANVAS_CACHE_KEY]) {
    win[CANVAS_CACHE_KEY] = canvas;
  }
  return canvas.getContext("2d");
};

const measureTextWidth = (text: string) => {
  const context = measuringContext();
  if (!context) {
    return estimateTextWidth({text});
  }
  context.font = `${BUBBLE_FONT_WEIGHT} ${BUBBLE_FONT_SIZE}px ${FONT_FAMILY}`;
  return context.measureText(text).width;
};

const maxTextWidthFor = (container: ChatSpec["sceneConfig"]["container"]) => {
  const horizontalPadding = container === "none" ? 184 : 44;
  const availableRowWidth = (CHAT_WIDTH - horizontalPadding) * ROW_MAX_WIDTH_RATIO;
  return availableRowWidth - AVATAR_SIZE - AVATAR_GAP - BUBBLE_HORIZONTAL_PADDING;
};

const wrapMessageText = (text: string, maxTextWidth: number) => {
  const paragraphs = text.split("\n");
  const wrapped = paragraphs.map((paragraph) => {
    if (!paragraph || measureTextWidth(paragraph) <= maxTextWidth) {
      return paragraph;
    }
    const lines: string[] = [];
    let currentLine = "";
    for (const char of paragraph) {
      const nextLine = currentLine + char;
      if (currentLine && measureTextWidth(nextLine) > maxTextWidth) {
        lines.push(currentLine);
        currentLine = char;
        continue;
      }
      currentLine = nextLine;
    }
    if (currentLine) {
      lines.push(currentLine);
    }
    return lines.join("\n");
  });
  return wrapped.join("\n");
};

const bubbleWidthFor = (text: string, maxTextWidth: number) => {
  const lines = text.split("\n");
  const widestLine = lines.reduce((max, line) => Math.max(max, measureTextWidth(line)), 0);
  return Math.min(maxTextWidth, widestLine + BUBBLE_WIDTH_SAFETY) + BUBBLE_HORIZONTAL_PADDING;
};

type Container = ChatSpec["sceneConfig"]["container"];
type Message = ChatSpec["messages"][number];

const SIDE_STYLE = {
  left: {align: "flex-start", flexDirection: "row", transformOrigin: "left center", slideFrom: -26},
  right: {align: "flex-end", flexDirection: "row-reverse", transformOrigin: "right center", slideFrom: 26},
} as const;

const EMPHASIS_STYLE = {
  highlight: {boxShadow: "0 8px 26px rgba(236,135,120,0.18)", border: "2px solid rgba(235,135,120,0.45)"},
  plain: {boxShadow: "0 2px 6px rgba(0,0,0,0.05)", border: "1px solid rgba(0,0,0,0.04)"},
} as const;

/** Wrapped text, rendered width and wrap mode of one bubble's text. */
const bubbleTextLayout = ({text, container}: {text: string; container: Container}) => {
  const maxTextWidth = maxTextWidthFor(container);
  const displayText = wrapMessageText(text, maxTextWidth);
  const fitsSingleLine = !text.includes("\n") && measureTextWidth(text) + BUBBLE_WIDTH_SAFETY <= maxTextWidth;
  return {displayText, fitsSingleLine, bubbleWidth: bubbleWidthFor(displayText, maxTextWidth)};
};

const bubbleColors = ({container, isRight}: {container: Container; isRight: boolean}) => {
  const theme = CONTAINER_THEME[container];
  return {
    background: isRight ? theme.bubbleRight : theme.bubbleLeft,
    color: container === "messenger" && isRight ? "#FFFFFF" : "#1F1F1F",
  };
};

const isNameShown = ({nicknameMode, seenBySpeaker}: {nicknameMode: ChatSpec["sceneConfig"]["nicknameMode"]; seenBySpeaker: boolean}) =>
  nicknameMode === "always" || (nicknameMode === "first-message-only" && !seenBySpeaker);

/** Entrance animation of a bubble `local` frames after it appears. */
const bubbleMotion = ({local, fps, slideFrom}: {local: number; fps: number; slideFrom: number}) => ({
  scale: spring({frame: local, fps, config: {damping: 14, stiffness: 180, mass: 0.7}, durationInFrames: 18}),
  x: interpolate(local, [0, 12], [slideFrom, 0], {extrapolateRight: "clamp"}),
  opacity: interpolate(local, [0, 8], [0, 1], {extrapolateRight: "clamp"}),
});

const Bubble = ({
  message,
  participant,
  chatSpec,
  seenBySpeaker,
}: {
  message: Message;
  participant: ChatSpec["participants"][number];
  chatSpec: ChatSpec;
  seenBySpeaker: boolean;
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const {container, nicknameMode} = chatSpec.sceneConfig;
  const isRight = message.side === "right";
  if (frame < message.appearAt) {
    return <div style={{display: "none"}} />;
  }
  const side = SIDE_STYLE[isRight ? "right" : "left"];
  const {scale, x, opacity} = bubbleMotion({local: frame - message.appearAt, fps, slideFrom: side.slideFrom});
  const colors = bubbleColors({container, isRight});
  const {displayText, fitsSingleLine, bubbleWidth} = bubbleTextLayout({text: message.text, container});
  const emphasis = EMPHASIS_STYLE[message.highlight ? "highlight" : "plain"];
  return (
    <div
      style={{
        display: "flex",
        marginBottom: 14,
        opacity,
        justifyContent: side.align,
      }}
    >
      <div style={{display: "flex", gap: 12, alignItems: "flex-start", flexDirection: side.flexDirection, maxWidth: "86%"}}>
        <AvatarImage src={avatarSrcFor(participant)} />
        <div style={{maxWidth: "calc(100% - 76px)", display: "flex", flexDirection: "column", alignItems: side.align, gap: 6}}>
          {isNameShown({nicknameMode, seenBySpeaker}) ? <div style={{fontSize: 18, color: "#7C8490", fontWeight: 700}}>{message.speaker}</div> : null}
          <div
            style={{
              background: colors.background,
              display: "block",
              width: Math.ceil(bubbleWidth),
              maxWidth: "100%",
              padding: "16px 22px",
              borderRadius: 16,
              fontSize: BUBBLE_FONT_SIZE,
              lineHeight: 1.35,
              fontWeight: BUBBLE_FONT_WEIGHT,
              color: colors.color,
              fontFamily: FONT_FAMILY,
              whiteSpace: fitsSingleLine ? "nowrap" : "pre-wrap",
              wordBreak: "break-word",
              overflowWrap: "normal",
              boxShadow: emphasis.boxShadow,
              border: emphasis.border,
              transform: `translateX(${x}px) scale(${scale})`,
              transformOrigin: side.transformOrigin,
            }}
          >
            {displayText}
          </div>
        </div>
      </div>
    </div>
  );
};

export const BubbleScene = ({chatSpec}: {chatSpec: ChatSpec}) => {
  const frame = useCurrentFrame();
  const theme = CONTAINER_THEME[chatSpec.sceneConfig.container];
  const headerOpacity = interpolate(frame, [0, 12], [0, 1], {extrapolateRight: "clamp"});
  const seen = new Set<string>();
  const participantsByName = new Map(chatSpec.participants.map((participant) => [participant.name, participant]));
  const showContainer = chatSpec.sceneConfig.container !== "none";
  const inner = (
    <>
      {showContainer ? (
        <>
          <div
            style={{
              height: 132,
              background: theme.headerBg,
              borderBottom: "1px solid rgba(0,0,0,0.06)",
              display: "flex",
              alignItems: "flex-end",
              padding: "0 22px 14px",
              opacity: headerOpacity,
              flexShrink: 0,
            }}
          >
            <div style={{fontSize: 40, color: "#1F1F1F", fontWeight: 300, width: 32}}>‹</div>
            <div style={{flex: 1, textAlign: "center", fontSize: 28, fontWeight: 700, color: "#1F1F1F"}}>{chatSpec.title}</div>
            <div style={{fontSize: 36, color: "#1F1F1F", letterSpacing: 3, width: 32, textAlign: "right"}}>···</div>
          </div>
          {chatSpec.sceneConfig.showTimestamp ? (
            <div style={{textAlign: "center", marginTop: 18, marginBottom: 20, color: theme.subtitle, fontSize: 22, fontWeight: 500, opacity: headerOpacity}}>
              {chatSpec.timestamp}
            </div>
          ) : null}
        </>
      ) : null}
      <div style={{padding: showContainer ? "0 22px" : "180px 92px", flex: 1, width: "100%"}}>
        {chatSpec.messages.map((message) => {
          const seenBefore = seen.has(message.speaker);
          seen.add(message.speaker);
          const participant = participantsByName.get(message.speaker);
          if (!participant) return null;
          return <Bubble key={message.id} message={message} participant={participant} chatSpec={chatSpec} seenBySpeaker={seenBefore} />;
        })}
      </div>
    </>
  );
  if (!showContainer) {
    return (
      <div
        style={{
          width: 1080,
          height: 1920,
          display: "flex",
          flexDirection: "column",
          background: "transparent",
        }}
      >
        {inner}
      </div>
    );
  }
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: theme.screenBg,
        display: "flex",
        flexDirection: "column",
        fontFamily: FONT_FAMILY,
        overflow: "hidden",
      }}
    >
      {inner}
    </div>
  );
};

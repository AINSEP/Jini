/**
 * @file Wire shape of a desktop zoom command, shared by the main-process app menu (which sends it)
 * and the renderer zoom feature (which applies it). One neutral owner so the two cannot drift.
 */

/** Zoom in, zoom out, or back to actual size (Cmd/Ctrl + `+`, `-`, `0`). */
export type ZoomDirection = 'in' | 'out' | 'reset';

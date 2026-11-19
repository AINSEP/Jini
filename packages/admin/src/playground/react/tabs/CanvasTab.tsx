import type { TabViewProps } from '@jini-ai/core/contracts/admin-module';
import { Canvas } from '../components/Canvas.js';
export function CanvasTab(props: TabViewProps, _optional = {}) { return <Canvas {...props} />; }
export default CanvasTab;

import { Registry } from '../../core/registry.js';
import { AmbientMode } from './ambient.js';
import { TrailMode } from './trail.js';
import { BurstMode } from './burst.js';
import { LightningMode } from './lightning.js';
import { VortexMode } from './vortex.js';
import { ScatterMode } from './scatter.js';
import { DualLinkMode } from './dualLink.js';
import { CursorMode } from './cursor.js';

export function registerBuiltinModes() {
  Registry.registerMode('ambient', AmbientMode);
  Registry.registerMode('trail', TrailMode);
  Registry.registerMode('burst', BurstMode);
  Registry.registerMode('lightning', LightningMode);
  Registry.registerMode('vortex', VortexMode);
  Registry.registerMode('scatter', ScatterMode);
  Registry.registerMode('dualLink', DualLinkMode);
  Registry.registerMode('cursor', CursorMode);
}

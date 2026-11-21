import { createRegistry } from '../../core/registry.js';
import burst from './burst.js';
import free from './free.js';
import idle from './idle.js';
import lightning from './lightning.js';
import scatter from './scatter.js';
import trail from './trail.js';
import vortex from './vortex.js';

/**
 * 粒子特效注册表。新特效：写一个 { create(params, engine) => { update, integrate, onEnter?, draw? } }
 * 的模块并在此注册，然后在 particles.json 的 effects 中添加同名参数、在 gestures.json 中引用即可。
 */
export const effectRegistry = createRegistry('effect');
effectRegistry
  .register('free', free)
  .register('idle', idle)
  .register('trail', trail)
  .register('burst', burst)
  .register('lightning', lightning)
  .register('vortex', vortex)
  .register('scatter', scatter);

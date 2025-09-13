// Browser shim for Node's child_process used in some loaders.gl internals
export function spawn() {
  throw new Error('child_process.spawn is not available in the browser');
}
export default { spawn } as any;

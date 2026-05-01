import { HarnessWorker } from '../worker.js';

describe('HarnessWorker', () => {
  test('should be instantiable', () => {
    const worker = new HarnessWorker({
      prompt: 'test',
    });
    expect(worker).toBeDefined();
  });
});
import { expect, test, vi } from 'vitest';

vi.mock('node:worker_threads', () => ({ parentPort: null, workerData: undefined }));
vi.mock('../src/pdfjsLoader', () => ({ getPdfDocument: vi.fn() }));
vi.mock('../src/pageRenderer', () => ({ renderPdfPage: vi.fn() }));

test('rejects direct execution outside a worker thread', async () => {
    await expect(import('../src/pageRenderWorker.js')).rejects.toThrow('pageRenderWorker must be started as a worker thread.');
});

import type { OutputSink } from './interfaces/output.sink.js';

export class NullSink implements OutputSink {
    public async write(_name: string, _content: Buffer): Promise<string> {
        return '';
    }
}

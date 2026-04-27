import { savePNGfile } from './outputWriter.js';
import type { OutputSink } from './interfaces/output.sink.js';

export class FilesystemSink implements OutputSink {
    constructor(
        private readonly resolvedOutputFolder: string,
        private readonly realOutputFolder: string,
    ) {}

    public async write(name: string, content: Buffer): Promise<string> {
        return await savePNGfile(name, content, this.resolvedOutputFolder, this.realOutputFolder);
    }
}

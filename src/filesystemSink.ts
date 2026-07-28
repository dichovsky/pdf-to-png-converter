import type { OutputSink } from './interfaces/output.sink.js';
import type { OutputFolderHandle } from './outputWriter.js';
import { savePNGfile } from './outputWriter.js';

export class FilesystemSink implements OutputSink {
    constructor(private readonly folder: OutputFolderHandle) {}

    public async write(name: string, content: Buffer): Promise<string> {
        return await savePNGfile(name, content, this.folder);
    }
}
